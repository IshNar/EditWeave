use std::io::{Read, Seek, SeekFrom, Write};

#[derive(Clone)]
struct Atom { start: u64, size: u64, header: u64, kind: [u8; 4] }

pub fn apply(path: &std::path::Path, mastering: Option<&serde_json::Value>, max_cll: Option<u16>, max_fall: Option<u16>) -> Result<(), String> {
    if mastering.is_none() && max_cll.is_none() && max_fall.is_none() { return Ok(()); }
    let mut source = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let length = source.metadata().map_err(|error| error.to_string())?.len();
    let mut position = 0;
    let mut target: Option<(Atom, Vec<Atom>)> = None;
    while position + 8 <= length {
        let atom = read_atom(&mut source, position, length)?;
        if atom.kind == *b"moov" { target = find_hevc_sample_entry(&mut source, &atom, Vec::new())?; break; }
        position = atom.start + atom.size;
    }
    let Some((sample_entry, ancestors)) = target else { return Err("완성 MP4에서 HEVC sample entry를 찾지 못했습니다.".into()); };
    let insertion = sample_entry.start + sample_entry.size;
    let boxes = metadata_boxes(mastering, max_cll, max_fall)?;
    if boxes.is_empty() { return Ok(()); }
    let delta = boxes.len() as u64;
    let temporary = path.with_extension("editweave-hdr.tmp");
    let backup = path.with_extension("editweave-hdr.backup");
    let mut output = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
    source.seek(SeekFrom::Start(0)).map_err(|error| error.to_string())?;
    std::io::copy(&mut Read::by_ref(&mut source).take(insertion), &mut output).map_err(|error| error.to_string())?;
    output.write_all(&boxes).map_err(|error| error.to_string())?;
    source.seek(SeekFrom::Start(insertion)).map_err(|error| error.to_string())?;
    std::io::copy(&mut source, &mut output).map_err(|error| error.to_string())?;
    output.flush().map_err(|error| error.to_string())?;
    drop(output);
    drop(source);

    let mut patched = std::fs::OpenOptions::new().read(true).write(true).open(&temporary).map_err(|error| error.to_string())?;
    for atom in ancestors.iter().chain(std::iter::once(&sample_entry)) { write_expanded_size(&mut patched, atom, delta)?; }
    patch_chunk_offsets(&mut patched, insertion, delta)?;
    patched.flush().map_err(|error| error.to_string())?;
    patched.sync_all().map_err(|error| error.to_string())?;
    drop(patched);

    let _ = std::fs::remove_file(&backup);
    std::fs::rename(path, &backup).map_err(|error| error.to_string())?;
    if let Err(error) = std::fs::rename(&temporary, path) {
        let _ = std::fs::rename(&backup, path);
        let _ = std::fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    let _ = std::fs::remove_file(backup);
    Ok(())
}

fn find_hevc_sample_entry(file: &mut std::fs::File, atom: &Atom, mut ancestors: Vec<Atom>) -> Result<Option<(Atom, Vec<Atom>)>, String> {
    ancestors.push(atom.clone());
    if atom.kind == *b"stsd" {
        let mut header = [0u8; 8];
        file.seek(SeekFrom::Start(atom.start + atom.header)).map_err(|error| error.to_string())?;
        file.read_exact(&mut header).map_err(|error| error.to_string())?;
        let count = u32::from_be_bytes(header[4..8].try_into().unwrap());
        let mut position = atom.start + atom.header + 8;
        let end = atom.start + atom.size;
        for _ in 0..count {
            if position + 8 > end { break; }
            let entry = read_atom(file, position, end)?;
            if entry.kind == *b"hvc1" || entry.kind == *b"hev1" { return Ok(Some((entry, ancestors))); }
            position = entry.start + entry.size;
        }
        return Ok(None);
    }
    if !is_container(atom.kind) { return Ok(None); }
    let mut position = atom.start + atom.header + if atom.kind == *b"meta" { 4 } else { 0 };
    let end = atom.start + atom.size;
    while position + 8 <= end {
        let child = read_atom(file, position, end)?;
        if let Some(found) = find_hevc_sample_entry(file, &child, ancestors.clone())? { return Ok(Some(found)); }
        position = child.start + child.size;
    }
    Ok(None)
}

fn patch_chunk_offsets(file: &mut std::fs::File, insertion: u64, delta: u64) -> Result<(), String> {
    let length = file.metadata().map_err(|error| error.to_string())?.len();
    let mut position = 0;
    while position + 8 <= length {
        let atom = read_atom(file, position, length)?;
        patch_offsets_in_atom(file, &atom, insertion, delta)?;
        position = atom.start + atom.size;
    }
    Ok(())
}

fn patch_offsets_in_atom(file: &mut std::fs::File, atom: &Atom, insertion: u64, delta: u64) -> Result<(), String> {
    if atom.kind == *b"stco" || atom.kind == *b"co64" {
        file.seek(SeekFrom::Start(atom.start + atom.header + 4)).map_err(|error| error.to_string())?;
        let mut count_bytes = [0u8; 4];
        file.read_exact(&mut count_bytes).map_err(|error| error.to_string())?;
        let count = u32::from_be_bytes(count_bytes);
        let width = if atom.kind == *b"stco" { 4u64 } else { 8u64 };
        for index in 0..count as u64 {
            let offset_position = atom.start + atom.header + 8 + index * width;
            file.seek(SeekFrom::Start(offset_position)).map_err(|error| error.to_string())?;
            let value = if width == 4 {
                let mut bytes = [0u8; 4]; file.read_exact(&mut bytes).map_err(|error| error.to_string())?; u32::from_be_bytes(bytes) as u64
            } else {
                let mut bytes = [0u8; 8]; file.read_exact(&mut bytes).map_err(|error| error.to_string())?; u64::from_be_bytes(bytes)
            };
            if value >= insertion {
                let next = value.checked_add(delta).ok_or_else(|| "MP4 chunk offset overflow".to_string())?;
                if width == 4 && next > u32::MAX as u64 { return Err("HDR 메타데이터 추가 후 stco가 32-bit 범위를 넘습니다.".into()); }
                file.seek(SeekFrom::Start(offset_position)).map_err(|error| error.to_string())?;
                if width == 4 { file.write_all(&(next as u32).to_be_bytes()).map_err(|error| error.to_string())?; }
                else { file.write_all(&next.to_be_bytes()).map_err(|error| error.to_string())?; }
            }
        }
        return Ok(());
    }
    if !is_container(atom.kind) || atom.kind == *b"stsd" { return Ok(()); }
    let mut position = atom.start + atom.header + if atom.kind == *b"meta" { 4 } else { 0 };
    let end = atom.start + atom.size;
    while position + 8 <= end {
        let child = read_atom(file, position, end)?;
        patch_offsets_in_atom(file, &child, insertion, delta)?;
        position = child.start + child.size;
    }
    Ok(())
}

fn write_expanded_size(file: &mut std::fs::File, atom: &Atom, delta: u64) -> Result<(), String> {
    let next = atom.size.checked_add(delta).ok_or_else(|| "MP4 atom size overflow".to_string())?;
    if atom.header == 16 {
        file.seek(SeekFrom::Start(atom.start + 8)).map_err(|error| error.to_string())?;
        file.write_all(&next.to_be_bytes()).map_err(|error| error.to_string())?;
    } else {
        if next > u32::MAX as u64 { return Err("HDR 메타데이터 추가 후 MP4 atom이 32-bit 크기를 넘습니다.".into()); }
        file.seek(SeekFrom::Start(atom.start)).map_err(|error| error.to_string())?;
        file.write_all(&(next as u32).to_be_bytes()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn metadata_boxes(mastering: Option<&serde_json::Value>, max_cll: Option<u16>, max_fall: Option<u16>) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    if matches!((max_cll, max_fall), (Some(cll), Some(fall)) if fall > cll) {
        return Err("MaxCLL은 MaxFALL보다 크거나 같아야 합니다.".into());
    }
    if let Some(value) = mastering {
        let coordinate = |name: &str| -> Result<u16, String> {
            let number = value.get(name).and_then(|item| item.as_f64()).filter(|number| number.is_finite()).ok_or_else(|| format!("{name} 색도 좌표가 없습니다."))?;
            if !(0.0..=1.0).contains(&number) { return Err(format!("{name} 색도 좌표는 0~1 범위여야 합니다.")); }
            Ok((number * 50_000.0).round() as u16)
        };
        let luminance = |name: &str| -> Result<u32, String> {
            let number = value.get(name).and_then(|item| item.as_f64()).filter(|number| number.is_finite()).ok_or_else(|| format!("{name} 휘도 값이 없습니다."))?;
            if !(0.0..=10_000.0).contains(&number) { return Err(format!("{name} 휘도는 0~10,000 nit 범위여야 합니다.")); }
            Ok((number * 10_000.0).round() as u32)
        };
        // ISO/IEC 14496-12 mdcv stores display primaries in G, B, R order.
        let coordinates: Result<Vec<u16>, String> = ["greenX", "greenY", "blueX", "blueY", "redX", "redY", "whitePointX", "whitePointY"].iter().map(|name| coordinate(name)).collect();
        let coordinates = coordinates?;
        let maximum = luminance("maxLuminance")?;
        let minimum = luminance("minLuminance")?;
        if maximum == 0 || maximum <= minimum { return Err("마스터링 최대 휘도는 0보다 크고 최소 휘도보다 커야 합니다.".into()); }
        let mut payload = Vec::with_capacity(24);
        for item in coordinates { payload.extend_from_slice(&item.to_be_bytes()); }
        payload.extend_from_slice(&maximum.to_be_bytes());
        payload.extend_from_slice(&minimum.to_be_bytes());
        output.extend_from_slice(&make_box(*b"mdcv", &payload));
    }
    if max_cll.is_some() || max_fall.is_some() {
        let mut payload = Vec::with_capacity(4);
        payload.extend_from_slice(&max_cll.unwrap_or(0).to_be_bytes());
        payload.extend_from_slice(&max_fall.unwrap_or(0).to_be_bytes());
        output.extend_from_slice(&make_box(*b"clli", &payload));
    }
    Ok(output)
}

fn make_box(kind: [u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(8 + payload.len());
    output.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
    output.extend_from_slice(&kind);
    output.extend_from_slice(payload);
    output
}

fn read_atom(file: &mut std::fs::File, start: u64, limit: u64) -> Result<Atom, String> {
    file.seek(SeekFrom::Start(start)).map_err(|error| error.to_string())?;
    let mut header = [0u8; 16];
    file.read_exact(&mut header[..8]).map_err(|error| error.to_string())?;
    let short = u32::from_be_bytes(header[0..4].try_into().unwrap()) as u64;
    let kind: [u8; 4] = header[4..8].try_into().unwrap();
    let (size, header_size) = if short == 1 {
        file.read_exact(&mut header[8..16]).map_err(|error| error.to_string())?;
        (u64::from_be_bytes(header[8..16].try_into().unwrap()), 16)
    } else if short == 0 { (limit - start, 8) } else { (short, 8) };
    if size < header_size || start.checked_add(size).map(|end| end > limit).unwrap_or(true) { return Err(format!("손상된 MP4 atom {:?}", String::from_utf8_lossy(&kind))); }
    Ok(Atom { start, size, header: header_size, kind })
}

fn is_container(kind: [u8; 4]) -> bool {
    matches!(&kind, b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" | b"dinf" | b"edts" | b"udta" | b"meta")
}

#[cfg(test)]
mod tests {
    use super::metadata_boxes;

    fn mastering() -> serde_json::Value {
        serde_json::json!({
            "redX": 0.708, "redY": 0.292, "greenX": 0.17, "greenY": 0.797,
            "blueX": 0.131, "blueY": 0.046, "whitePointX": 0.3127, "whitePointY": 0.329,
            "minLuminance": 0.005, "maxLuminance": 1000.0
        })
    }

    #[test]
    fn serializes_mdcv_and_clli_at_the_required_integer_scales() {
        let boxes = metadata_boxes(Some(&mastering()), Some(1000), Some(400)).unwrap();
        assert_eq!(&boxes[4..8], b"mdcv");
        assert_eq!(u16::from_be_bytes(boxes[8..10].try_into().unwrap()), 8_500);
        assert_eq!(u16::from_be_bytes(boxes[12..14].try_into().unwrap()), 6_550);
        assert_eq!(u16::from_be_bytes(boxes[16..18].try_into().unwrap()), 35_400);
        assert_eq!(u32::from_be_bytes(boxes[24..28].try_into().unwrap()), 10_000_000);
        assert_eq!(u32::from_be_bytes(boxes[28..32].try_into().unwrap()), 50);
        assert_eq!(&boxes[36..40], b"clli");
        assert_eq!(u16::from_be_bytes(boxes[40..42].try_into().unwrap()), 1000);
        assert_eq!(u16::from_be_bytes(boxes[42..44].try_into().unwrap()), 400);
    }

    #[test]
    fn rejects_out_of_range_or_contradictory_metadata() {
        let mut invalid = mastering();
        invalid["redX"] = serde_json::json!(1.2);
        assert!(metadata_boxes(Some(&invalid), None, None).is_err());
        assert!(metadata_boxes(None, Some(500), Some(600)).is_err());
    }
}
