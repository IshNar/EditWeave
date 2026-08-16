use std::io::{Read, Seek, SeekFrom};

#[derive(Debug)]
pub struct QuickTimeTimecode {
    pub timecode: String,
    pub reel_name: Option<String>,
    pub frame_rate: String,
}

#[derive(Clone, Copy)]
struct Atom<'a> {
    kind: [u8; 4],
    body: &'a [u8],
}

pub fn probe(path: &std::path::Path) -> Result<QuickTimeTimecode, String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let file_len = file.metadata().map_err(|error| error.to_string())?.len();
    let (moov_offset, moov_size) = find_top_level_atom(&mut file, file_len, *b"moov")?
        .ok_or_else(|| "QuickTime moov atom을 찾지 못했습니다.".to_string())?;
    if moov_size > 256 * 1024 * 1024 { return Err("QuickTime moov atom이 안전 판독 한도를 넘습니다.".to_string()); }
    file.seek(SeekFrom::Start(moov_offset)).map_err(|error| error.to_string())?;
    let mut moov = vec![0u8; moov_size as usize];
    file.read_exact(&mut moov).map_err(|error| error.to_string())?;

    for trak in atoms(&moov).filter(|atom| atom.kind == *b"trak") {
        let Some(mdia) = atoms(trak.body).find(|atom| atom.kind == *b"mdia") else { continue };
        let Some(handler) = atoms(mdia.body).find(|atom| atom.kind == *b"hdlr") else { continue };
        if handler.body.get(8..12) != Some(b"tmcd") { continue; }
        let Some(minf) = atoms(mdia.body).find(|atom| atom.kind == *b"minf") else { continue };
        let Some(stbl) = atoms(minf.body).find(|atom| atom.kind == *b"stbl") else { continue };
        let Some(description) = parse_tmcd_description(stbl.body) else { continue };
        let Some(sample_offset) = first_chunk_offset(stbl.body) else { continue };
        let sample_size = first_sample_size(stbl.body).unwrap_or(4);
        if sample_size < 4 || sample_offset.saturating_add(4) > file_len { continue; }
        file.seek(SeekFrom::Start(sample_offset)).map_err(|error| error.to_string())?;
        let mut sample = [0u8; 4];
        file.read_exact(&mut sample).map_err(|error| error.to_string())?;
        let raw_frames = if description.flags & 0x0008 != 0 {
            u32::from_be_bytes(sample) as i64
        } else {
            i32::from_be_bytes(sample) as i64
        };
        if raw_frames < 0 || description.nominal_fps == 0 || description.time_scale == 0 || description.frame_duration == 0 { continue; }
        let timecode = format_frame_number(raw_frames as u64, description.nominal_fps as u64, description.flags);
        let divisor = gcd(description.time_scale, description.frame_duration);
        return Ok(QuickTimeTimecode {
            timecode,
            reel_name: description.reel_name,
            frame_rate: format!("{}/{}", description.time_scale / divisor, description.frame_duration / divisor),
        });
    }
    Err("QuickTime tmcd 트랙을 찾지 못했습니다.".to_string())
}

struct TimecodeDescription {
    flags: u32,
    time_scale: u32,
    frame_duration: u32,
    nominal_fps: u8,
    reel_name: Option<String>,
}

fn parse_tmcd_description(stbl: &[u8]) -> Option<TimecodeDescription> {
    let stsd = atoms(stbl).find(|atom| atom.kind == *b"stsd")?;
    if stsd.body.len() < 8 { return None; }
    let entry_count = be_u32(stsd.body, 4)? as usize;
    let mut offset = 8usize;
    for _ in 0..entry_count {
        let entry_size = be_u32(stsd.body, offset)? as usize;
        if entry_size < 34 || offset.checked_add(entry_size)? > stsd.body.len() { return None; }
        let entry = &stsd.body[offset..offset + entry_size];
        if entry.get(4..8) == Some(b"tmcd") {
            return Some(TimecodeDescription {
                flags: be_u32(entry, 20)?,
                time_scale: be_u32(entry, 24)?,
                frame_duration: be_u32(entry, 28)?,
                nominal_fps: *entry.get(32)?,
                reel_name: extract_source_name(entry.get(34..).unwrap_or_default()),
            });
        }
        offset += entry_size;
    }
    None
}

fn first_chunk_offset(stbl: &[u8]) -> Option<u64> {
    for atom in atoms(stbl) {
        if atom.body.len() < 12 { continue; }
        if atom.kind == *b"stco" && be_u32(atom.body, 4)? > 0 { return be_u32(atom.body, 8).map(u64::from); }
        if atom.kind == *b"co64" && be_u32(atom.body, 4)? > 0 { return be_u64(atom.body, 8); }
    }
    None
}

fn first_sample_size(stbl: &[u8]) -> Option<u64> {
    let atom = atoms(stbl).find(|atom| atom.kind == *b"stsz")?;
    let fixed = be_u32(atom.body, 4)?;
    if fixed > 0 { return Some(u64::from(fixed)); }
    if be_u32(atom.body, 8)? == 0 { return None; }
    be_u32(atom.body, 12).map(u64::from)
}

fn extract_source_name(data: &[u8]) -> Option<String> {
    for atom in atoms(data) {
        if matches!(&atom.kind, b"name" | b"reel" | b"\xa9nam") {
            let text = printable_text(atom.body);
            if !text.is_empty() { return Some(text); }
        }
        if matches!(&atom.kind, b"udta" | b"meta") {
            let nested = if atom.kind == *b"meta" && atom.body.len() >= 4 { &atom.body[4..] } else { atom.body };
            if let Some(text) = extract_source_name(nested) { return Some(text); }
        }
    }
    None
}

fn printable_text(data: &[u8]) -> String {
    let start = data.iter().position(|byte| *byte >= 0x20).unwrap_or(data.len());
    String::from_utf8_lossy(&data[start..])
        .trim_matches(|character: char| character == '\0' || character.is_control())
        .chars().take(200).collect::<String>()
}

fn format_frame_number(frame_number: u64, nominal_fps: u64, flags: u32) -> String {
    let drop_frame = flags & 0x0001 != 0 && (nominal_fps == 30 || nominal_fps == 60);
    let mut display_frames = frame_number;
    if drop_frame {
        let dropped = if nominal_fps == 60 { 4 } else { 2 };
        let frames_per_minute = nominal_fps * 60 - dropped;
        let frames_per_ten_minutes = nominal_fps * 600 - dropped * 9;
        let blocks = display_frames / frames_per_ten_minutes;
        let remainder = display_frames % frames_per_ten_minutes;
        display_frames += dropped * 9 * blocks;
        if remainder >= dropped { display_frames += dropped * ((remainder - dropped) / frames_per_minute); }
    }
    if flags & 0x0002 != 0 { display_frames %= nominal_fps * 60 * 60 * 24; }
    let hours = display_frames / (nominal_fps * 3600);
    let minutes = (display_frames / (nominal_fps * 60)) % 60;
    let seconds = (display_frames / nominal_fps) % 60;
    let frames = display_frames % nominal_fps;
    format!("{hours:02}:{minutes:02}:{seconds:02}{}{frames:02}", if drop_frame { ';' } else { ':' })
}

fn find_top_level_atom(file: &mut std::fs::File, file_len: u64, wanted: [u8; 4]) -> Result<Option<(u64, u64)>, String> {
    let mut offset = 0u64;
    while offset.saturating_add(8) <= file_len {
        file.seek(SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
        let mut header = [0u8; 16];
        file.read_exact(&mut header[..8]).map_err(|error| error.to_string())?;
        let size32 = u32::from_be_bytes(header[..4].try_into().unwrap()) as u64;
        let kind: [u8; 4] = header[4..8].try_into().unwrap();
        let (size, header_size) = if size32 == 1 {
            file.read_exact(&mut header[8..16]).map_err(|error| error.to_string())?;
            (u64::from_be_bytes(header[8..16].try_into().unwrap()), 16)
        } else if size32 == 0 { (file_len - offset, 8) } else { (size32, 8) };
        if size < header_size || offset.saturating_add(size) > file_len { return Err("손상된 QuickTime atom 크기입니다.".to_string()); }
        if kind == wanted { return Ok(Some((offset + header_size, size - header_size))); }
        offset += size;
    }
    Ok(None)
}

fn atoms(data: &[u8]) -> impl Iterator<Item = Atom<'_>> {
    let mut offset = 0usize;
    std::iter::from_fn(move || {
        if offset.checked_add(8)? > data.len() { return None; }
        let size32 = u32::from_be_bytes(data[offset..offset + 4].try_into().ok()?) as usize;
        let kind: [u8; 4] = data[offset + 4..offset + 8].try_into().ok()?;
        let (size, header) = if size32 == 1 {
            if offset.checked_add(16)? > data.len() { return None; }
            (usize::try_from(u64::from_be_bytes(data[offset + 8..offset + 16].try_into().ok()?)).ok()?, 16)
        } else if size32 == 0 { (data.len() - offset, 8) } else { (size32, 8) };
        if size < header || offset.checked_add(size)? > data.len() { offset = data.len(); return None; }
        let atom = Atom { kind, body: &data[offset + header..offset + size] };
        offset += size;
        Some(atom)
    })
}

fn be_u32(data: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(offset..offset + 4)?.try_into().ok()?))
}

fn be_u64(data: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_be_bytes(data.get(offset..offset + 8)?.try_into().ok()?))
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 { let next = left % right; left = right; right = next; }
    left.max(1)
}
