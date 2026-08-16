mod quicktime_timecode;
mod hdr_metadata;
mod lan_review;
mod project_lock;
mod update_signature;
mod update_installer;

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "qt", "mkv", "webm", "mxf", "gxf", "avi", "m4v", "mts", "m2ts", "ts", "mpeg", "mpg", "mpe", "m2v", "m1v", "m2p", "vob", "3gp", "dv", "flv", "f4v", "wmv", "asf", "ogv", "mjpeg", "mjpg", "y4m", "nut", "r3d", "braw", "crm", "ari", "cin",
    "mp3", "mp2", "mpa", "wav", "bwf", "rf64", "m4a", "aac", "adts", "flac", "ogg", "oga", "aif", "aiff", "caf", "w64", "ac3", "eac3", "opus", "ape", "amr", "mka", "au", "snd",
    "png", "jpg", "jpeg", "jpe", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "tga", "dpx", "exr", "hdr", "psd", "jp2", "j2k", "j2c", "jpf", "jpx", "sgi", "pic",
];

fn quick_media_signature(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Seek, SeekFrom};
    const CHUNK: usize = 1024 * 1024;
    let mut file = std::fs::File::open(path).map_err(|error| format!("미디어 지문을 위해 파일을 열지 못했습니다: {error}"))?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    let mut hasher = Sha256::new();
    hasher.update(b"cutline-media-signature-v1\0");
    hasher.update(size.to_le_bytes());
    let mut read_chunk = |offset: u64, label: &[u8]| -> Result<(), String> {
        file.seek(SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
        let remaining = size.saturating_sub(offset).min(CHUNK as u64) as usize;
        let mut buffer = vec![0u8; remaining];
        file.read_exact(&mut buffer).map_err(|error| error.to_string())?;
        hasher.update(label);
        hasher.update(offset.to_le_bytes());
        hasher.update(buffer);
        Ok(())
    };
    read_chunk(0, b"first")?;
    if size > CHUNK as u64 * 2 { read_chunk(size / 2, b"middle")?; }
    if size > CHUNK as u64 { read_chunk(size.saturating_sub(CHUNK as u64), b"last")?; }
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedUpdatePayload {
    schema: String,
    platform: String,
    download_url: String,
    sha256: String,
}

fn verified_update_payload(public_key: &str, signature: &str, payload: &str) -> Result<SignedUpdatePayload, String> {
    if !update_signature::verify_trusted(public_key, signature, payload)? { return Err("업데이트 매니페스트 서명이 올바르지 않습니다.".into()); }
    let manifest: SignedUpdatePayload = serde_json::from_str(payload).map_err(|_| "업데이트 서명 payload JSON이 올바르지 않습니다.".to_string())?;
    if manifest.schema != "cutline-update-v1" { return Err("업데이트 서명 payload schema가 올바르지 않습니다.".into()); }
    update_installer::validate_platform(&manifest.platform)?;
    Ok(manifest)
}

fn ffmpeg_jobs() -> &'static std::sync::Mutex<std::collections::HashMap<String, std::process::Child>> {
    static JOBS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::process::Child>>> = std::sync::OnceLock::new();
    JOBS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn authorized_scratch_roots() -> &'static std::sync::Mutex<std::collections::HashSet<std::path::PathBuf>> {
    static ROOTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<std::path::PathBuf>>> = std::sync::OnceLock::new();
    ROOTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

#[tauri::command]
fn authorize_scratch_directory(app: tauri::AppHandle, directory: String) -> Result<String, String> {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    let root = std::fs::canonicalize(&directory).map_err(|error| format!("스크래치 디스크를 열 수 없습니다 ({directory}): {error}"))?;
    if !root.is_dir() { return Err("스크래치 디스크 경로가 폴더가 아닙니다.".into()); }
    app.fs_scope().allow_directory(&root, true).map_err(|error| error.to_string())?;
    app.asset_protocol_scope().allow_directory(&root, true).map_err(|error| error.to_string())?;
    authorized_scratch_roots().lock().map_err(|_| "스크래치 디스크 경로 잠금 오류".to_string())?.insert(root.clone());
    Ok(root.to_string_lossy().to_string())
}

fn custom_scratch_path(root: &str, category: &str, parts: &[&str]) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(root).map_err(|error| format!("스크래치 디스크를 열 수 없습니다: {error}"))?;
    if !authorized_scratch_roots().lock().map_err(|_| "스크래치 디스크 경로 잠금 오류".to_string())?.contains(&canonical) {
        return Err("선택하여 허용한 스크래치 디스크가 아닙니다.".into());
    }
    let mut path = canonical.join("Cutline").join(category);
    for part in parts { path = path.join(safe_scratch_part(part)); }
    Ok(path)
}

fn safe_scratch_part(value: &str) -> String {
    let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' || character == '.' { character } else { '-' }).collect();
    let trimmed = result.trim_matches(|character| character == '-' || character == '.');
    if trimmed.is_empty() { "item".to_string() } else { trimmed.to_string() }
}

fn scratch_area_directory(app: &tauri::AppHandle, kind: &str, scratch_root: Option<&str>) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    match (kind, scratch_root) {
        ("proxy", Some(root)) => custom_scratch_path(root, "Proxies", &[]),
        ("recording", Some(root)) => custom_scratch_path(root, "Recordings", &[]),
        ("render", Some(root)) => custom_scratch_path(root, "Render-Cache", &[]),
        ("proxy", None) => Ok(app.path().app_cache_dir().map_err(|error| error.to_string())?.join("proxies")),
        ("recording", None) => Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("recordings")),
        ("render", None) => Ok(app.path().app_cache_dir().map_err(|error| error.to_string())?.join("render-sessions")),
        _ => Err("알 수 없는 스크래치 저장 영역입니다.".into()),
    }
}

#[tauri::command]
fn scratch_disk_usage(app: tauri::AppHandle, kind: String, scratch_root: Option<String>) -> Result<serde_json::Value, String> {
    let directory = scratch_area_directory(&app, &kind, scratch_root.as_deref())?;
    if !directory.is_dir() { return Ok(serde_json::json!({ "bytes": 0, "files": 0 })); }
    let mut pending = vec![directory];
    let mut bytes = 0u64;
    let mut files = 0u64;
    while let Some(folder) = pending.pop() {
        let entries = match std::fs::read_dir(folder) { Ok(value) => value, Err(_) => continue };
        for entry in entries.flatten() {
            let metadata = match entry.metadata() { Ok(value) => value, Err(_) => continue };
            if metadata.is_dir() { pending.push(entry.path()); }
            else if metadata.is_file() { files += 1; bytes = bytes.saturating_add(metadata.len()); }
        }
    }
    Ok(serde_json::json!({ "bytes": bytes, "files": files }))
}

#[tauri::command]
fn clear_scratch_area(app: tauri::AppHandle, kind: String, scratch_root: Option<String>) -> Result<serde_json::Value, String> {
    if kind == "recording" { return Err("ADR·보이스오버 원본은 스크래치 일괄 정리 대상이 아닙니다.".into()); }
    let directory = scratch_area_directory(&app, &kind, scratch_root.as_deref())?;
    let usage = scratch_disk_usage(app, kind, scratch_root)?;
    if directory.is_dir() { std::fs::remove_dir_all(&directory).map_err(|error| error.to_string())?; }
    Ok(usage)
}

fn safe_identifier(value: &str, fallback: &str) -> String {
    let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' { character } else { '-' }).collect();
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
}

fn render_session_directory(app: &tauri::AppHandle, job_id: &str, scratch_root: Option<&str>) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    match scratch_root {
        Some(root) => custom_scratch_path(root, "Render-Cache", &[job_id]),
        None => Ok(app.path().app_cache_dir().map_err(|error| error.to_string())?.join("render-sessions").join(safe_identifier(job_id, "render"))),
    }
}

fn media_tool_path(app: &tauri::AppHandle, tool: &str) -> std::path::PathBuf {
    use tauri::Manager;
    let executable = if cfg!(target_os = "windows") { format!("{tool}.exe") } else { tool.to_string() };
    let environment_key = match tool {
        "ffmpeg" => "CUTLINE_FFMPEG_PATH",
        "ffprobe" => "CUTLINE_FFPROBE_PATH",
        _ => "CUTLINE_MEDIA_TOOL_PATH",
    };
    if let Some(configured) = std::env::var_os(environment_key).map(std::path::PathBuf::from).filter(|path| path.is_file()) {
        return configured;
    }
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("bin").join(&executable));
        candidates.push(resource_dir.join("bin").join(&executable));
    }
    if let Ok(current_executable) = std::env::current_exe() {
        if let Some(directory) = current_executable.parent() {
            candidates.push(directory.join("resources").join("bin").join(&executable));
            candidates.push(directory.join("bin").join(&executable));
        }
    }
    candidates.into_iter().find(|path| path.is_file()).unwrap_or_else(|| std::path::PathBuf::from(executable))
}

fn media_tool_command(app: &tauri::AppHandle, tool: &str) -> std::process::Command {
    let mut command = std::process::Command::new(media_tool_path(app, tool));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn media_tool_version(app: &tauri::AppHandle, tool: &str) -> serde_json::Value {
    let path = media_tool_path(app, tool);
    let bundled = path.is_file();
    let output = media_tool_command(app, tool).arg("-version").output();
    match output {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or_default().trim().to_string();
            serde_json::json!({ "available": true, "bundled": bundled, "path": path, "version": version })
        }
        Ok(output) => serde_json::json!({ "available": false, "bundled": bundled, "path": path, "error": String::from_utf8_lossy(&output.stderr).trim() }),
        Err(error) => serde_json::json!({ "available": false, "bundled": bundled, "path": path, "error": error.to_string() }),
    }
}

#[tauri::command]
fn codec_toolchain_status(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "schema": "cutline-codec-toolchain-v1",
        "ffmpeg": media_tool_version(&app, "ffmpeg"),
        "ffprobe": media_tool_version(&app, "ffprobe")
    })
}

#[tauri::command]
fn prepare_render_segment(app: tauri::AppHandle, job_id: String, index: u32, scratch_root: Option<String>) -> Result<String, String> {
    if index > 100_000 { return Err("렌더 구간 번호가 허용 범위를 벗어났습니다.".into()); }
    let directory = render_session_directory(&app, &job_id, scratch_root.as_deref())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("segment-{index:06}.mp4")).to_string_lossy().to_string())
}

#[tauri::command]
fn prepare_render_hdr_raw_segment(app: tauri::AppHandle, job_id: String, index: u32, scratch_root: Option<String>) -> Result<String, String> {
    if index > 100_000 { return Err("HDR raw 구간 번호가 허용 범위를 벗어났습니다.".into()); }
    let directory = render_session_directory(&app, &job_id, scratch_root.as_deref())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("segment-{index:06}.yuv")).to_string_lossy().to_string())
}

#[tauri::command]
async fn decode_render_hdr_source(app: tauri::AppHandle, job_id: String, index: u32, slot: u32, source_path: String, scratch_root: Option<String>, range_start: f64, width: u32, height: u32, fps: f64, frames: u32) -> Result<String, String> {
    use tauri_plugin_fs::FsExt;
    if index > 100_000 || slot > 1_000 || width < 16 || height < 16 || width > 8192 || height > 8192 || width % 4 != 0 || height % 2 != 0 { return Err("HDR 원본 디코드 구성이 허용 범위를 벗어났습니다.".into()); }
    if !range_start.is_finite() || range_start < 0.0 || !fps.is_finite() || !(1.0..=240.0).contains(&fps) || frames == 0 || frames > 1_000_000 { return Err("HDR 원본 디코드 시간·프레임 구성이 올바르지 않습니다.".into()); }
    let directory = render_session_directory(&app, &job_id, scratch_root.as_deref())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    app.fs_scope().allow_directory(&directory, true).map_err(|error| error.to_string())?;
    let raw = directory.join(format!("source-{index:06}-{slot:03}.yuv"));
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::fs::canonicalize(&source_path).map_err(|error| format!("HDR 원본을 찾을 수 없습니다: {error}"))?;
        if !source.is_file() { return Err("HDR 원본 경로가 파일이 아닙니다.".to_string()); }
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
        let temporary = directory.join(format!(".cutline-hdr-source-{nonce}.yuv"));
        let start = format!("{range_start:.6}");
        let size = format!("{width}x{height}");
        let fps_value = format!("{fps:.6}");
        let frames_value = frames.to_string();
        let filter = format!("fps={fps_value},scale={size}:flags=lanczos,format=yuv420p10le");
        let result = media_tool_command(&app, "ffmpeg").args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &start, "-i"]).arg(&source)
            .args(["-map", "0:v:0", "-an", "-vf", &filter, "-frames:v", &frames_value, "-pix_fmt", "yuv420p10le", "-f", "rawvideo"]).arg(&temporary)
            .output().map_err(|error| format!("HDR 원본 디코더를 실행하지 못했습니다: {error}"))?;
        if !result.status.success() { let _ = std::fs::remove_file(&temporary); return Err(format!("HDR 원본 10-bit 디코딩에 실패했습니다: {}", String::from_utf8_lossy(&result.stderr).trim())); }
        let expected = u64::from(width).checked_mul(u64::from(height)).and_then(|value| value.checked_mul(3)).and_then(|value| value.checked_mul(u64::from(frames))).ok_or_else(|| "HDR 디코드 크기 계산이 넘쳤습니다.".to_string())?;
        let actual = std::fs::metadata(&temporary).map_err(|error| error.to_string())?.len();
        if actual != expected { let _ = std::fs::remove_file(&temporary); return Err(format!("HDR 디코드 크기가 일치하지 않습니다 ({actual}/{expected} bytes).")); }
        if raw.is_file() { std::fs::remove_file(&raw).map_err(|error| error.to_string())?; }
        std::fs::rename(&temporary, &raw).map_err(|error| error.to_string())?;
        Ok(raw.to_string_lossy().to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn encode_render_hdr_segment(app: tauri::AppHandle, raw_path: String, output_path: String, width: u32, height: u32, fps: f64, frames: u32, bitrate_mbps: u32, transfer: String) -> Result<(), String> {
    if width < 16 || height < 16 || width > 8192 || height > 8192 || width % 4 != 0 || height % 2 != 0 { return Err("HDR raw 출력 크기가 허용 범위를 벗어났습니다.".into()); }
    if !fps.is_finite() || !(1.0..=240.0).contains(&fps) || frames == 0 || frames > 1_000_000 { return Err("HDR raw 프레임 구성이 올바르지 않습니다.".into()); }
    if !(1..=300).contains(&bitrate_mbps) { return Err("HDR 비트레이트는 1~300Mbps 범위여야 합니다.".into()); }
    if transfer != "pq" && transfer != "hlg" { return Err("HDR transfer는 pq 또는 hlg여야 합니다.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let raw = std::fs::canonicalize(&raw_path).map_err(|error| format!("HDR raw 프레임 파일을 찾을 수 없습니다: {error}"))?;
        if raw.extension().and_then(|value| value.to_str()) != Some("yuv") { return Err("HDR raw 입력 확장자는 .yuv여야 합니다.".to_string()); }
        let expected_bytes = u64::from(width).checked_mul(u64::from(height)).and_then(|value| value.checked_mul(3)).and_then(|value| value.checked_mul(u64::from(frames))).ok_or_else(|| "HDR raw 크기 계산이 넘쳤습니다.".to_string())?;
        let actual_bytes = std::fs::metadata(&raw).map_err(|error| error.to_string())?.len();
        if actual_bytes != expected_bytes { return Err(format!("HDR raw 프레임 크기가 일치하지 않습니다 ({actual_bytes}/{expected_bytes} bytes).")); }
        let output = std::path::PathBuf::from(&output_path);
        let parent = output.parent().ok_or_else(|| "HDR 구간 출력 폴더를 찾을 수 없습니다.".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
        let temporary = parent.join(format!(".cutline-hdr-{nonce}.mp4"));
        let size = format!("{width}x{height}");
        let fps_value = format!("{fps:.6}");
        let frames_value = frames.to_string();
        let bitrate = format!("{bitrate_mbps}M");
        let key_interval = (fps * 2.0).round().max(1.0) as u32;
        let key_interval = key_interval.to_string();
        let transfer_value = if transfer == "pq" { "smpte2084" } else { "arib-std-b67" };
        let x265_params = if transfer == "pq" { format!("repeat-headers=1:hdr-opt=1:keyint={key_interval}:min-keyint={key_interval}:scenecut=0") } else { format!("repeat-headers=1:keyint={key_interval}:min-keyint={key_interval}:scenecut=0") };
        let result = media_tool_command(&app, "ffmpeg").args(["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "yuv420p10le", "-video_size", &size, "-framerate", &fps_value, "-i"]).arg(&raw)
            .args(["-frames:v", &frames_value, "-an", "-c:v", "libx265", "-preset", "medium", "-b:v", &bitrate, "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-color_primaries", "bt2020", "-color_trc", transfer_value, "-colorspace", "bt2020nc", "-color_range", "tv", "-x265-params", &x265_params])
            .arg(&temporary).output().map_err(|error| format!("HEVC Main10 코덱 엔진을 실행하지 못했습니다: {error}"))?;
        if !result.status.success() { let _ = std::fs::remove_file(&temporary); return Err(format!("HEVC Main10 구간 인코딩에 실패했습니다: {}", String::from_utf8_lossy(&result.stderr).trim())); }
        if std::fs::metadata(&temporary).map(|metadata| metadata.len() > 1024).unwrap_or(false) == false { let _ = std::fs::remove_file(&temporary); return Err("HEVC Main10 구간 결과가 비어 있습니다.".into()); }
        if output.is_file() { std::fs::remove_file(&output).map_err(|error| format!("기존 HDR 구간을 교체하지 못했습니다: {error}"))?; }
        std::fs::rename(&temporary, &output).map_err(|error| format!("HEVC Main10 구간을 확정하지 못했습니다: {error}"))?;
        let _ = std::fs::remove_file(&raw);
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn prepare_render_audio_master(app: tauri::AppHandle, job_id: String, scratch_root: Option<String>, format: Option<String>) -> Result<String, String> {
    let directory = render_session_directory(&app, &job_id, scratch_root.as_deref())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let extension = format.as_deref().unwrap_or("m4a");
    if extension != "m4a" && extension != "wav" { return Err("연속 오디오 마스터 형식은 m4a 또는 wav여야 합니다.".into()); }
    Ok(directory.join(format!("continuous-audio-master.{extension}")).to_string_lossy().to_string())
}

#[tauri::command]
async fn mux_render_surround_audio(app: tauri::AppHandle, video_path: String, audio_path: String, bitrate_kbps: u32, sample_rate: u32) -> Result<(), String> {
    if !(192..=640).contains(&bitrate_kbps) { return Err("AAC 5.1 비트레이트는 192~640kbps 범위여야 합니다.".into()); }
    if sample_rate != 44_100 && sample_rate != 48_000 && sample_rate != 96_000 { return Err("지원하지 않는 AAC 5.1 샘플레이트입니다.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let video = std::fs::canonicalize(&video_path).map_err(|error| format!("영상 결합 대상을 찾을 수 없습니다: {error}"))?;
        let audio = std::fs::canonicalize(&audio_path).map_err(|error| format!("5.1 오디오 마스터를 찾을 수 없습니다: {error}"))?;
        if !video.is_file() || !audio.is_file() { return Err("AAC 5.1 결합 입력이 파일이 아닙니다.".to_string()); }
        if audio.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("wav")) != Some(true) { return Err("AAC 5.1 결합 입력은 WAV여야 합니다.".to_string()); }
        let parent = video.parent().ok_or_else(|| "영상 출력 폴더를 찾을 수 없습니다.".to_string())?;
        let stem = video.file_stem().and_then(|value| value.to_str()).unwrap_or("cutline-output");
        let extension = video.extension().and_then(|value| value.to_str()).unwrap_or("mp4");
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
        let temporary = parent.join(format!(".{stem}.cutline-surround-{nonce}.{extension}"));
        let backup = parent.join(format!(".{stem}.cutline-before-surround-{nonce}.{extension}"));
        let bitrate = format!("{bitrate_kbps}k");
        let sample_rate = sample_rate.to_string();
        let output = media_tool_command(&app, "ffmpeg").args(["-y", "-hide_banner", "-loglevel", "error", "-i"]).arg(&video)
            .args(["-i"]).arg(&audio)
            .args(["-map", "0:v:0", "-map", "1:a:0", "-map_metadata", "0", "-c:v", "copy", "-c:a", "aac", "-b:a", &bitrate, "-ar", &sample_rate, "-ac", "6", "-channel_layout", "5.1", "-movflags", "+faststart", "-shortest"])
            .arg(&temporary).output().map_err(|error| format!("AAC 5.1 결합 엔진을 실행하지 못했습니다: {error}"))?;
        if !output.status.success() { let _ = std::fs::remove_file(&temporary); return Err(format!("AAC 5.1 결합에 실패했습니다: {}", String::from_utf8_lossy(&output.stderr).trim())); }
        if std::fs::metadata(&temporary).map(|metadata| metadata.len() > 1024).unwrap_or(false) == false { let _ = std::fs::remove_file(&temporary); return Err("AAC 5.1 결합 결과가 비어 있습니다.".into()); }
        std::fs::rename(&video, &backup).map_err(|error| format!("기존 영상 보존에 실패했습니다: {error}"))?;
        if let Err(error) = std::fs::rename(&temporary, &video) {
            let _ = std::fs::rename(&backup, &video);
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("AAC 5.1 결과 교체에 실패했습니다: {error}"));
        }
        let _ = std::fs::remove_file(&backup);
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn inspect_render_segments(app: tauri::AppHandle, job_id: String, scratch_root: Option<String>) -> Result<Vec<u32>, String> {
    let directory = render_session_directory(&app, &job_id, scratch_root.as_deref())?;
    if !directory.is_dir() { return Ok(Vec::new()); }
    let mut indices = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("mp4") || entry.metadata().map(|value| value.len()).unwrap_or(0) < 512 { continue; }
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else { continue; };
        if let Some(value) = stem.strip_prefix("segment-").and_then(|value| value.parse::<u32>().ok()) { indices.push(value); }
    }
    indices.sort_unstable();
    indices.dedup();
    Ok(indices)
}

#[tauri::command]
fn cleanup_render_segments(app: tauri::AppHandle, job_id: String, scratch_root: Option<String>) -> Result<(), String> {
    let directory = render_session_directory(&app, &job_id, scratch_root.as_deref())?;
    if directory.is_dir() { std::fs::remove_dir_all(directory).map_err(|error| error.to_string())?; }
    Ok(())
}

#[tauri::command]
fn verify_update_signature(public_key: String, signature: String, payload: String) -> Result<bool, String> {
    update_signature::verify_trusted(&public_key, &signature, &payload)
}

#[tauri::command]
async fn download_update_installer(public_key: String, signature: String, payload: String, destination_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = verified_update_payload(&public_key, &signature, &payload)?;
        update_installer::download(&manifest.download_url, &manifest.sha256, &destination_path).and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn prepare_existing_update_installer(public_key: String, signature: String, payload: String, installer_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = verified_update_payload(&public_key, &signature, &payload)?;
        update_installer::prepare_existing(&manifest.sha256, &installer_path).and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn launch_verified_update(token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || update_installer::launch(&token)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn apply_hdr_output_metadata(output_path: String, mastering: Option<serde_json::Value>, max_cll: Option<u16>, max_fall: Option<u16>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || hdr_metadata::apply(std::path::Path::new(&output_path), mastering.as_ref(), max_cll, max_fall)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn start_lan_review(token: String, project_name: String, sequence_id: String, video_path: String, comments: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    lan_review::start(token, project_name, sequence_id, video_path, comments)
}

#[tauri::command]
fn sync_lan_review(token: String, comments: Vec<serde_json::Value>, deleted_ids: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    lan_review::sync(&token, comments, deleted_ids)
}

#[tauri::command]
fn delete_lan_review_comment(token: String, comment_id: String) -> Result<(), String> {
    lan_review::delete_comment(&token, &comment_id)
}

#[tauri::command]
fn stop_lan_review(token: String) -> Result<(), String> {
    lan_review::stop(&token)
}

#[tauri::command]
fn acquire_project_lock(project_path: String, instance_id: String, now_ms: u64, force: bool) -> Result<serde_json::Value, String> {
    project_lock::acquire(&project_path, &instance_id, now_ms, force)
}

#[tauri::command]
fn heartbeat_project_lock(project_path: String, instance_id: String, now_ms: u64) -> Result<bool, String> {
    project_lock::heartbeat(&project_path, &instance_id, now_ms)
}

#[tauri::command]
fn release_project_lock(project_path: String, instance_id: String) -> Result<(), String> {
    project_lock::release(&project_path, &instance_id)
}

#[tauri::command]
fn app_environment() -> serde_json::Value {
    serde_json::json!({
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "desktop": true
    })
}

#[tauri::command]
fn desktop_stream_conformance_config(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    use tauri_plugin_fs::FsExt;
    if std::env::var("CUTLINE_CONFORMANCE_MODE").ok().as_deref() != Some("desktop-stream") { return Ok(None); }
    let duration = std::env::var("CUTLINE_CONFORMANCE_DURATION_SECONDS").ok().and_then(|value| value.parse::<u32>().ok()).unwrap_or(60);
    if !(30..=3_600).contains(&duration) { return Err("데스크톱 스트리밍 적합성 시간은 30~3600초여야 합니다.".into()); }
    let audio_channels = std::env::var("CUTLINE_CONFORMANCE_AUDIO_CHANNELS").ok().and_then(|value| value.parse::<u32>().ok()).unwrap_or(1);
    if audio_channels != 1 && audio_channels != 6 { return Err("데스크톱 스트리밍 적합성 오디오 채널은 1 또는 6이어야 합니다.".into()); }
    let color_mode = std::env::var("CUTLINE_CONFORMANCE_COLOR_MODE").unwrap_or_else(|_| "sdr".into());
    if color_mode != "sdr" && color_mode != "hdr10-pq" && color_mode != "hdr-hlg" { return Err("데스크톱 스트리밍 적합성 색상 모드는 sdr, hdr10-pq, hdr-hlg 중 하나여야 합니다.".into()); }
    let hdr_effect = std::env::var("CUTLINE_CONFORMANCE_HDR_EFFECT").ok().as_deref() == Some("exposure");
    let output = std::env::var("CUTLINE_CONFORMANCE_OUTPUT_PATH").map_err(|_| "CUTLINE_CONFORMANCE_OUTPUT_PATH가 필요합니다.".to_string())?;
    let report = std::env::var("CUTLINE_CONFORMANCE_REPORT_PATH").map_err(|_| "CUTLINE_CONFORMANCE_REPORT_PATH가 필요합니다.".to_string())?;
    let audio_fixture = std::env::var("CUTLINE_CONFORMANCE_AUDIO_PATH").map_err(|_| "CUTLINE_CONFORMANCE_AUDIO_PATH가 필요합니다.".to_string())?;
    let hdr_fixture = std::env::var("CUTLINE_CONFORMANCE_HDR_SOURCE_PATH").ok();
    let output_path = std::path::PathBuf::from(output);
    let report_path = std::path::PathBuf::from(report);
    let audio_fixture_path = std::path::PathBuf::from(audio_fixture);
    if !output_path.is_absolute() || !report_path.is_absolute() || !audio_fixture_path.is_absolute() { return Err("적합성 출력·보고서·오디오 기준은 절대 경로여야 합니다.".into()); }
    if output_path.extension().and_then(|value| value.to_str()) != Some("mp4") || report_path.extension().and_then(|value| value.to_str()) != Some("json") || audio_fixture_path.extension().and_then(|value| value.to_str()) != Some("wav") { return Err("적합성 출력은 .mp4, 보고서는 .json, 오디오 기준은 .wav여야 합니다.".into()); }
    if !audio_fixture_path.is_file() { return Err("적합성 PCM 오디오 기준 파일이 없습니다.".into()); }
    let hdr_fixture_path = hdr_fixture.map(std::path::PathBuf::from);
    if color_mode != "sdr" && !hdr_fixture_path.as_ref().map(|path| path.is_absolute() && path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("mp4")).unwrap_or(false) { return Err("HDR 적합성에는 절대 경로의 CUTLINE_CONFORMANCE_HDR_SOURCE_PATH .mp4가 필요합니다.".into()); }
    let output_parent = output_path.parent().ok_or_else(|| "적합성 출력 폴더가 없습니다.".to_string())?;
    let report_parent = report_path.parent().ok_or_else(|| "적합성 보고서 폴더가 없습니다.".to_string())?;
    if output_parent != report_parent || audio_fixture_path.parent() != Some(output_parent) { return Err("적합성 출력·보고서·오디오 기준은 같은 전용 폴더에 있어야 합니다.".into()); }
    std::fs::create_dir_all(output_parent).map_err(|error| error.to_string())?;
    let directory = std::fs::canonicalize(output_parent).map_err(|error| error.to_string())?;
    app.fs_scope().allow_directory(&directory, true).map_err(|error| error.to_string())?;
    Ok(Some(serde_json::json!({
        "durationSeconds": duration,
        "audioChannels": audio_channels,
        "colorMode": color_mode,
        "hdrEffect": hdr_effect,
        "outputPath": output_path,
        "reportPath": report_path,
        "segmentDirectory": directory,
        "audioFixturePath": audio_fixture_path,
        "hdrFixturePath": hdr_fixture_path,
        "fixtureUrl": if color_mode == "hdr10-pq" { "/e2e/render-conformance-hdr10-pq.mp4" } else if color_mode == "hdr-hlg" { "/e2e/render-conformance-hdr-hlg.mp4" } else { "/e2e/render-conformance-10m.mp4" }
    })))
}

#[tauri::command]
fn authorize_media_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    if paths.len() > 500 { return Err("한 번에 연결할 수 있는 미디어는 500개입니다.".into()); }
    let fs_scope = app.fs_scope();
    let asset_scope = app.asset_protocol_scope();
    paths.into_iter().map(|path| {
        let canonical = std::fs::canonicalize(&path).map_err(|error| format!("미디어 경로를 열 수 없습니다 ({path}): {error}"))?;
        if !canonical.is_file() { return Err(format!("미디어 파일이 아닙니다: {}", canonical.display())); }
        let extension = canonical.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        if !MEDIA_EXTENSIONS.contains(&extension.as_str()) { return Err(format!("허용되지 않은 미디어 확장자입니다: .{extension}")); }
        fs_scope.allow_file(&canonical).map_err(|error| error.to_string())?;
        asset_scope.allow_file(&canonical).map_err(|error| error.to_string())?;
        Ok(canonical.to_string_lossy().to_string())
    }).collect()
}

#[tauri::command]
fn find_media_relink_candidates(directory: String, names: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    use std::collections::HashSet;
    if names.is_empty() { return Ok(Vec::new()); }
    if names.len() > 500 { return Err("한 번에 검색할 수 있는 오프라인 미디어는 500개입니다.".into()); }
    let root = std::fs::canonicalize(&directory).map_err(|error| format!("재연결 폴더를 열 수 없습니다 ({directory}): {error}"))?;
    if !root.is_dir() { return Err("선택한 경로가 폴더가 아닙니다.".into()); }
    let media_key = |value: &str| {
        let filename = std::path::Path::new(value).file_name().and_then(|item| item.to_str()).unwrap_or(value).to_lowercase();
        let stem = std::path::Path::new(&filename).file_stem().and_then(|item| item.to_str()).unwrap_or(&filename);
        stem.chars().filter(|character| character.is_alphanumeric()).collect::<String>()
    };
    let wanted: HashSet<String> = names.iter().map(|name| name.to_lowercase()).collect();
    let wanted_keys: HashSet<String> = names.iter().map(|name| media_key(name)).filter(|name| !name.is_empty()).collect();
    let mut pending = vec![root];
    let mut matches = Vec::new();
    let mut inspected = 0usize;
    while let Some(folder) = pending.pop() {
        let entries = match std::fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            inspected += 1;
            if inspected > 100_000 { return Err("폴더 항목이 100,000개를 넘어 검색을 중단했습니다. 더 작은 원본 폴더를 선택해주세요.".into()); }
            let file_type = match entry.file_type() { Ok(value) => value, Err(_) => continue };
            if file_type.is_symlink() { continue; }
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            let extension = entry.path().extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
            if !MEDIA_EXTENSIONS.contains(&extension.as_str()) { continue; }
            if !wanted.contains(&name.to_lowercase()) && !wanted_keys.contains(&media_key(&name)) { continue; }
            let metadata = entry.metadata().ok();
            let size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
            let modified_at = metadata.and_then(|value| value.modified().ok()).and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok()).map(|value| value.as_millis() as u64);
            let quick_signature = quick_media_signature(&entry.path()).ok();
            matches.push(serde_json::json!({ "path": entry.path().to_string_lossy(), "name": name, "size": size, "modifiedAt": modified_at, "quickSignature": quick_signature }));
        }
    }
    Ok(matches)
}

#[tauri::command]
async fn media_file_signature(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = std::fs::canonicalize(&path).map_err(|error| format!("미디어 지문 경로를 열 수 없습니다 ({path}): {error}"))?;
        if !canonical.is_file() { return Err("미디어 지문 대상이 파일이 아닙니다.".to_string()); }
        quick_media_signature(&canonical)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn reveal_media_in_file_manager(path: String) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&path).map_err(|error| format!("미디어 위치를 열 수 없습니다 ({path}): {error}"))?;
    if !canonical.is_file() { return Err("파일 위치 열기는 프로젝트에 연결된 미디어 파일만 허용됩니다.".into()); }
    let extension = canonical.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !MEDIA_EXTENSIONS.contains(&extension.as_str()) { return Err(format!("미디어 파일 위치만 열 수 있습니다: .{extension}")); }
    #[cfg(target_os = "windows")]
    let child = std::process::Command::new("explorer.exe").arg(format!("/select,{}", canonical.to_string_lossy())).spawn();
    #[cfg(target_os = "macos")]
    let child = std::process::Command::new("/usr/bin/open").arg("-R").arg(&canonical).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let child = std::process::Command::new("xdg-open").arg(canonical.parent().unwrap_or_else(|| std::path::Path::new("/"))).spawn();
    child.map(|_| ()).map_err(|error| format!("파일 관리자를 열지 못했습니다: {error}"))
}

#[tauri::command]
async fn trim_archive_media(app: tauri::AppHandle, source_path: String, target_path: String, start: f64, duration: f64) -> Result<(), String> {
    if !start.is_finite() || !duration.is_finite() || start < 0.0 || duration <= 0.0 { return Err("아카이브 미디어 범위가 올바르지 않습니다.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(source_path);
        let target = std::path::PathBuf::from(target_path);
        if !source.is_file() { return Err("아카이브할 원본 미디어를 찾을 수 없습니다.".to_string()); }
        if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        let output = media_tool_command(&app, "ffmpeg").args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &format!("{start:.6}"), "-i"]).arg(&source)
            .args(["-t", &format!("{duration:.6}"), "-map", "0", "-map_metadata", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"]).arg(&target).output()
            .map_err(|error| format!("아카이브 미디어 트리머를 실행하지 못했습니다: {error}"))?;
        if !output.status.success() { let _ = std::fs::remove_file(&target); return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()); }
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_ffmpeg_proxy(
    app: tauri::AppHandle,
    source_path: String,
    project_id: String,
    asset_id: String,
    width: u32,
    height: u32,
    frame_rate: f64,
    audio_stream_index: Option<u32>,
    compatibility_mode: Option<bool>,
    scratch_root: Option<String>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let safe = |value: &str, fallback: &str| {
        let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' { character } else { '-' }).collect();
        let trimmed = result.trim_matches('-');
        if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
    };
    let relative = format!("proxies/{}/{}.mp4", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let output_path = match scratch_root.as_deref() {
        Some(root) => custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.mp4", safe(&asset_id, "asset"))])?,
        None => app.path().app_cache_dir().map_err(|error| error.to_string())?.join(&relative),
    };
    if let Some(parent) = output_path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let source = std::path::PathBuf::from(source_path);
    if !source.is_file() { return Err("원본 미디어 경로를 찾을 수 없습니다.".into()); }
    if !frame_rate.is_finite() || !(1.0..=240.0).contains(&frame_rate) { return Err("프록시 프레임레이트가 허용 범위를 벗어났습니다.".into()); }
    let audio_stream_index = audio_stream_index.unwrap_or(0);
    let compatibility_mode = compatibility_mode.unwrap_or(false);
    if audio_stream_index > 127 { return Err("오디오 스트림 번호가 허용 범위를 벗어났습니다.".into()); }
    let source_metadata = probe_media_metadata_path(&app, &source).unwrap_or_else(|_| serde_json::json!({}));
    let hdr_transfer = source_metadata.get("colorTransfer").and_then(|value| value.as_str()).map(str::to_string);
    let output_for_command = output_path.clone();
    let job_id = format!("{}:{}", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let codec_app = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        let mut command = media_tool_command(&codec_app, "ffmpeg");
        let audio_map = format!("0:a:{audio_stream_index}?");
        let scale_filter = if hdr_transfer.as_deref() == Some("smpte2084") || hdr_transfer.as_deref() == Some("arib-std-b67") {
            format!("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,scale={width}:{height}:force_original_aspect_ratio=decrease,fps={frame_rate}")
        } else { format!("scale={width}:{height}:force_original_aspect_ratio=decrease,fps={frame_rate}") };
        command.args([
            "-y", "-hide_banner", "-loglevel", "error", "-i"
        ]).arg(source).args([
            "-map", "0:v:0", "-map", &audio_map, "-map_metadata", "0", "-map_metadata:s:v:0", "0:s:v:0", "-vf", &scale_filter,
            // Proxies are navigation media; final exports still read the original.
            // A fast preset prevents compatibility conversion from starving the editor UI.
            "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-crf", if compatibility_mode { "20" } else { "28" }, "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", if compatibility_mode { "320k" } else { "128k" }, "-movflags", "+faststart"
        ]);
        if hdr_transfer.as_deref() == Some("smpte2084") || hdr_transfer.as_deref() == Some("arib-std-b67") {
            command.args(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]);
        }
        command.arg(output_for_command);
        let child = command.spawn().map_err(|error| format!("앱 코덱 엔진을 실행하지 못했습니다: {error}"))?;
        ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.insert(job_id.clone(), child);
        loop {
            let status = {
                let mut jobs = ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?;
                let Some(child) = jobs.get_mut(&job_id) else { return Err("FFmpeg 프록시 작업이 취소되었습니다.".to_string()); };
                child.try_wait().map_err(|error| error.to_string())?
            };
            if let Some(status) = status {
                ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.remove(&job_id);
                return Ok(status);
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    }).await.map_err(|error| error.to_string())??;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err("앱 코덱 엔진의 프록시 변환에 실패했습니다. 원본 코덱 또는 파일 손상 여부를 확인해주세요.".into());
    }
    let size = std::fs::metadata(&output_path).map_err(|error| error.to_string())?.len();
    let proxy_metadata = probe_media_metadata_path(&app, &output_path).unwrap_or_else(|_| serde_json::json!({}));
    let cache_path = if scratch_root.is_some() { output_path.to_string_lossy().to_string() } else { relative };
    Ok(serde_json::json!({ "cachePath": cache_path, "size": size, "proxyTimecode": proxy_metadata.get("timecode").cloned().unwrap_or(serde_json::Value::Null) }))
}

#[tauri::command]
async fn create_ffmpeg_audio_proxy(
    app: tauri::AppHandle,
    source_path: String,
    project_id: String,
    asset_id: String,
    audio_stream_index: Option<u32>,
    scratch_root: Option<String>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let safe = |value: &str, fallback: &str| {
        let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' { character } else { '-' }).collect();
        let trimmed = result.trim_matches('-');
        if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
    };
    let relative = format!("proxies/{}/{}.wav", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let output_path = match scratch_root.as_deref() {
        Some(root) => custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.wav", safe(&asset_id, "asset"))])?,
        None => app.path().app_cache_dir().map_err(|error| error.to_string())?.join(&relative),
    };
    if let Some(parent) = output_path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let source = std::path::PathBuf::from(source_path);
    if !source.is_file() { return Err("원본 오디오 경로를 찾을 수 없습니다.".into()); }
    let audio_stream_index = audio_stream_index.unwrap_or(0);
    if audio_stream_index > 127 { return Err("오디오 스트림 번호가 허용 범위를 벗어났습니다.".into()); }
    let output_for_command = output_path.clone();
    let job_id = format!("{}:{}", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let codec_app = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        let mut command = media_tool_command(&codec_app, "ffmpeg");
        let audio_map = format!("0:a:{audio_stream_index}");
        command.args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
            .arg(source)
            .args(["-map", &audio_map, "-map_metadata", "0", "-vn", "-c:a", "pcm_s24le", "-ar", "48000", "-rf64", "auto"])
            .arg(output_for_command);
        let child = command.spawn().map_err(|error| format!("앱 오디오 코덱 엔진을 실행하지 못했습니다: {error}"))?;
        ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.insert(job_id.clone(), child);
        loop {
            let status = {
                let mut jobs = ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?;
                let Some(child) = jobs.get_mut(&job_id) else { return Err("FFmpeg 오디오 프록시 작업이 취소되었습니다.".to_string()); };
                child.try_wait().map_err(|error| error.to_string())?
            };
            if let Some(status) = status {
                ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.remove(&job_id);
                return Ok(status);
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    }).await.map_err(|error| error.to_string())??;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err("앱 코덱 엔진의 오디오 호환 변환에 실패했습니다. 원본 코덱 또는 파일 손상 여부를 확인해주세요.".into());
    }
    let size = std::fs::metadata(&output_path).map_err(|error| error.to_string())?.len();
    let cache_path = if scratch_root.is_some() { output_path.to_string_lossy().to_string() } else { relative };
    Ok(serde_json::json!({ "cachePath": cache_path, "size": size }))
}

#[tauri::command]
async fn create_ffmpeg_image_proxy(
    app: tauri::AppHandle,
    source_path: String,
    project_id: String,
    asset_id: String,
    scratch_root: Option<String>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let safe = |value: &str, fallback: &str| {
        let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' { character } else { '-' }).collect();
        let trimmed = result.trim_matches('-');
        if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
    };
    let relative = format!("proxies/{}/{}.png", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let output_path = match scratch_root.as_deref() {
        Some(root) => custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.png", safe(&asset_id, "asset"))])?,
        None => app.path().app_cache_dir().map_err(|error| error.to_string())?.join(&relative),
    };
    if let Some(parent) = output_path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let source = std::path::PathBuf::from(source_path);
    if !source.is_file() { return Err("원본 이미지 경로를 찾을 수 없습니다.".into()); }
    let source_metadata = probe_media_metadata_path(&app, &source).unwrap_or_else(|_| serde_json::json!({}));
    let hdr_transfer = source_metadata.get("colorTransfer").and_then(|value| value.as_str()).map(str::to_string);
    let output_for_command = output_path.clone();
    let job_id = format!("{}:{}", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let codec_app = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        let mut command = media_tool_command(&codec_app, "ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error", "-i"]).arg(source).args(["-map", "0:v:0", "-frames:v", "1"]);
        if hdr_transfer.as_deref() == Some("smpte2084") || hdr_transfer.as_deref() == Some("arib-std-b67") {
            command.args(["-vf", "zscale=t=linear:npl=100,format=gbrapf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=full,format=rgba"]);
        }
        command.args(["-c:v", "png", "-pix_fmt", "rgba", "-f", "image2"]).arg(output_for_command);
        let child = command.spawn().map_err(|error| format!("앱 이미지 코덱 엔진을 실행하지 못했습니다: {error}"))?;
        ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.insert(job_id.clone(), child);
        loop {
            let status = {
                let mut jobs = ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?;
                let Some(child) = jobs.get_mut(&job_id) else { return Err("FFmpeg 이미지 프록시 작업이 취소되었습니다.".to_string()); };
                child.try_wait().map_err(|error| error.to_string())?
            };
            if let Some(status) = status {
                ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.remove(&job_id);
                return Ok(status);
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    }).await.map_err(|error| error.to_string())??;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err("앱 코덱 엔진의 이미지 호환 변환에 실패했습니다. 원본 형식 또는 파일 손상 여부를 확인해주세요.".into());
    }
    let size = std::fs::metadata(&output_path).map_err(|error| error.to_string())?.len();
    let cache_path = if scratch_root.is_some() { output_path.to_string_lossy().to_string() } else { relative };
    Ok(serde_json::json!({ "cachePath": cache_path, "size": size }))
}

#[tauri::command]
async fn create_ffmpeg_image_sequence_proxy(
    app: tauri::AppHandle,
    source_paths: Vec<String>,
    project_id: String,
    asset_id: String,
    width: u32,
    height: u32,
    frame_rate: f64,
    compatibility_mode: Option<bool>,
    scratch_root: Option<String>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let safe = |value: &str, fallback: &str| {
        let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' { character } else { '-' }).collect();
        let trimmed = result.trim_matches('-');
        if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
    };
    if source_paths.len() < 2 || source_paths.len() > 100_000 { return Err("이미지 시퀀스는 2~100,000 프레임 범위여야 합니다.".into()); }
    if width < 2 || height < 2 || width > 16_384 || height > 16_384 || width % 2 != 0 || height % 2 != 0 { return Err("이미지 시퀀스 프록시 해상도가 올바르지 않습니다.".into()); }
    if !frame_rate.is_finite() || !(1.0..=240.0).contains(&frame_rate) { return Err("이미지 시퀀스 프레임레이트가 허용 범위를 벗어났습니다.".into()); }
    let compatibility_mode = compatibility_mode.unwrap_or(false);
    let sources: Vec<std::path::PathBuf> = source_paths.into_iter().map(std::path::PathBuf::from).collect();
    if sources.iter().any(|source| !source.is_file()) { return Err("이미지 시퀀스의 일부 원본 프레임을 찾을 수 없습니다.".into()); }
    let relative = format!("proxies/{}/{}.mp4", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let output_path = match scratch_root.as_deref() {
        Some(root) => custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.mp4", safe(&asset_id, "asset"))])?,
        None => app.path().app_cache_dir().map_err(|error| error.to_string())?.join(&relative),
    };
    if let Some(parent) = output_path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let list_path = output_path.with_extension("ffconcat");
    let source_metadata = probe_media_metadata_path(&app, &sources[0]).unwrap_or_else(|_| serde_json::json!({}));
    let hdr_transfer = source_metadata.get("colorTransfer").and_then(|value| value.as_str()).map(str::to_string);
    let frame_count = sources.len().to_string();
    let frame_duration = 1.0 / frame_rate;
    let mut concat = String::from("ffconcat version 1.0\n");
    for source in &sources {
        let escaped = source.to_string_lossy().replace('\\', "/").replace('\'', "\\'");
        concat.push_str(&format!("file '{escaped}'\nduration {frame_duration:.12}\n"));
    }
    if let Some(last) = sources.last() {
        let escaped = last.to_string_lossy().replace('\\', "/").replace('\'', "\\'");
        concat.push_str(&format!("file '{escaped}'\n"));
    }
    std::fs::write(&list_path, concat).map_err(|error| format!("이미지 시퀀스 목록을 만들지 못했습니다: {error}"))?;
    let output_for_command = output_path.clone();
    let list_for_command = list_path.clone();
    let job_id = format!("{}:{}", safe(&project_id, "project"), safe(&asset_id, "asset"));
    let codec_app = app.clone();
    let status_result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = media_tool_command(&codec_app, "ffmpeg");
        let filter = if hdr_transfer.as_deref() == Some("smpte2084") || hdr_transfer.as_deref() == Some("arib-std-b67") {
            format!("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,fps={frame_rate:.12},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black")
        } else {
            format!("fps={frame_rate:.12},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black")
        };
        command.args(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"])
            .arg(list_for_command)
            .args(["-map", "0:v:0", "-an", "-vf", &filter, "-frames:v", &frame_count, "-c:v", "libx264", "-preset", if compatibility_mode { "medium" } else { "veryfast" }, "-crf", if compatibility_mode { "17" } else { "20" }, "-pix_fmt", "yuv420p", "-movflags", "+faststart"])
            .arg(output_for_command);
        let child = command.spawn().map_err(|error| format!("앱 이미지 시퀀스 코덱 엔진을 실행하지 못했습니다: {error}"))?;
        ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.insert(job_id.clone(), child);
        loop {
            let status = {
                let mut jobs = ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?;
                let Some(child) = jobs.get_mut(&job_id) else { return Err("FFmpeg 이미지 시퀀스 작업이 취소되었습니다.".to_string()); };
                child.try_wait().map_err(|error| error.to_string())?
            };
            if let Some(status) = status {
                ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.remove(&job_id);
                return Ok(status);
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    }).await.map_err(|error| error.to_string());
    let _ = std::fs::remove_file(&list_path);
    let status = status_result??;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err("앱 코덱 엔진의 이미지 시퀀스 변환에 실패했습니다. 프레임 형식과 번호 순서를 확인해주세요.".into());
    }
    let size = std::fs::metadata(&output_path).map_err(|error| error.to_string())?.len();
    let cache_path = if scratch_root.is_some() { output_path.to_string_lossy().to_string() } else { relative };
    Ok(serde_json::json!({ "cachePath": cache_path, "size": size }))
}

#[tauri::command]
fn cancel_ffmpeg_proxy(app: tauri::AppHandle, project_id: String, asset_id: String, scratch_root: Option<String>) -> Result<(), String> {
    use tauri::Manager;
    let safe = |value: &str, fallback: &str| {
        let result: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || character == '-' || character == '_' { character } else { '-' }).collect();
        let trimmed = result.trim_matches('-');
        if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
    };
    let job_id = format!("{}:{}", safe(&project_id, "project"), safe(&asset_id, "asset"));
    if let Some(mut child) = ffmpeg_jobs().lock().map_err(|_| "FFmpeg 작업 잠금 오류".to_string())?.remove(&job_id) {
        child.kill().map_err(|error| error.to_string())?;
        let _ = child.wait();
    }
    let relative = format!("proxies/{}/{}.mp4", safe(&project_id, "project"), safe(&asset_id, "asset"));
    if let Some(root) = scratch_root.as_deref() {
        if let Ok(path) = custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.mp4", safe(&asset_id, "asset"))]) { let _ = std::fs::remove_file(path); }
        if let Ok(path) = custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.wav", safe(&asset_id, "asset"))]) { let _ = std::fs::remove_file(path); }
        if let Ok(path) = custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.png", safe(&asset_id, "asset"))]) { let _ = std::fs::remove_file(path); }
        if let Ok(path) = custom_scratch_path(root, "Proxies", &[&project_id, &format!("{}.ffconcat", safe(&asset_id, "asset"))]) { let _ = std::fs::remove_file(path); }
    } else if let Ok(path) = app.path().app_cache_dir() {
        let _ = std::fs::remove_file(path.join(relative));
        let audio_relative = format!("proxies/{}/{}.wav", safe(&project_id, "project"), safe(&asset_id, "asset"));
        let _ = std::fs::remove_file(path.join(audio_relative));
        let image_relative = format!("proxies/{}/{}.png", safe(&project_id, "project"), safe(&asset_id, "asset"));
        let _ = std::fs::remove_file(path.join(image_relative));
        let sequence_list_relative = format!("proxies/{}/{}.ffconcat", safe(&project_id, "project"), safe(&asset_id, "asset"));
        let _ = std::fs::remove_file(path.join(sequence_list_relative));
    }
    Ok(())
}

#[tauri::command]
async fn probe_media_metadata(app: tauri::AppHandle, source_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(source_path);
        if !source.is_file() { return Err("원본 미디어 경로를 찾을 수 없습니다.".to_string()); }
        probe_media_metadata_path(&app, &source)
    }).await.map_err(|error| error.to_string())?
}

fn probe_media_metadata_path(app: &tauri::AppHandle, source: &std::path::Path) -> Result<serde_json::Value, String> {
    let native_timecode = quicktime_timecode::probe(source).ok();
    match probe_media_metadata_ffprobe(app, source) {
        Ok(mut metadata) => {
            if let Some(native) = native_timecode {
                if metadata.get("timecode").map(|value| value.is_null()).unwrap_or(true) { metadata["timecode"] = serde_json::Value::String(native.timecode); }
                if metadata.get("reelName").map(|value| value.is_null()).unwrap_or(true) { metadata["reelName"] = native.reel_name.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null); }
                if metadata.get("frameRate").map(|value| value.is_null()).unwrap_or(true) { metadata["frameRate"] = serde_json::Value::String(native.frame_rate); }
            }
            Ok(metadata)
        }
        Err(ffprobe_error) => native_timecode.map(|native| serde_json::json!({
            "timecode": native.timecode,
            "reelName": native.reel_name,
            "frameRate": native.frame_rate,
            "metadataProvider": "native-tmcd"
        })).ok_or(ffprobe_error),
    }
}

fn probe_media_metadata_ffprobe(app: &tauri::AppHandle, source: &std::path::Path) -> Result<serde_json::Value, String> {
    let mut command = media_tool_command(app, "ffprobe");
    command.args([
        "-v", "error", "-show_entries",
        "stream=codec_type,codec_name,width,height,duration,sample_rate,channels,avg_frame_rate,r_frame_rate,color_space,color_transfer,color_primaries,color_range:stream_tags=timecode,reel_name,reel,language,title:stream_side_data=side_data_type,max_content,max_average,red_x,red_y,green_x,green_y,blue_x,blue_y,white_point_x,white_point_y,min_luminance,max_luminance:format=duration:format_tags=timecode,reel_name,reel",
        "-of", "json"
    ]).arg(source);
    let output = command.output().map_err(|error| format!("앱 코덱 분석기를 실행하지 못했습니다: {error}"))?;
    if !output.status.success() { return Err("컨테이너 메타데이터를 읽지 못했습니다.".to_string()); }
    let probe: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let streams = probe.get("streams").and_then(|value| value.as_array()).cloned().unwrap_or_default();
    let preferred = streams.iter().find(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("video"));
    let preferred_audio = streams.iter().find(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("audio"));
    let tag = |value: &serde_json::Value, names: &[&str]| -> Option<String> {
        let tags = value.get("tags")?.as_object()?;
        names.iter().find_map(|name| tags.get(*name).and_then(|item| item.as_str()).map(str::to_string))
    };
    let format = probe.get("format").cloned().unwrap_or_else(|| serde_json::json!({}));
    let number = |value: Option<&serde_json::Value>| -> Option<f64> {
        let value = value?;
        value.as_f64().or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
    };
    let duration = number(format.get("duration")).or_else(|| preferred.and_then(|stream| number(stream.get("duration")))).or_else(|| preferred_audio.and_then(|stream| number(stream.get("duration"))));
    let width = preferred.and_then(|stream| stream.get("width")).and_then(|value| value.as_u64());
    let height = preferred.and_then(|stream| stream.get("height")).and_then(|value| value.as_u64());
    let video_codec = preferred.and_then(|stream| stream.get("codec_name")).and_then(|value| value.as_str()).map(str::to_string);
    let audio_codec = preferred_audio.and_then(|stream| stream.get("codec_name")).and_then(|value| value.as_str()).map(str::to_string);
    let sample_rate = preferred_audio.and_then(|stream| number(stream.get("sample_rate")));
    let channels = preferred_audio.and_then(|stream| stream.get("channels")).and_then(|value| value.as_u64());
    let audio_streams: Vec<serde_json::Value> = streams.iter().filter(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("audio")).enumerate().map(|(index, stream)| serde_json::json!({
        "index": index,
        "codec": stream.get("codec_name").and_then(|value| value.as_str()),
        "sampleRate": number(stream.get("sample_rate")),
        "channels": stream.get("channels").and_then(|value| value.as_u64()),
        "language": tag(stream, &["language", "LANGUAGE"]),
        "title": tag(stream, &["title", "TITLE"])
    })).collect();
    let timecode = preferred.and_then(|stream| tag(stream, &["timecode", "TIMECODE"]))
        .or_else(|| streams.iter().find_map(|stream| tag(stream, &["timecode", "TIMECODE"])))
        .or_else(|| tag(&format, &["timecode", "TIMECODE"]));
    let reel_name = preferred.and_then(|stream| tag(stream, &["reel_name", "reel", "REEL_NAME", "REEL"]))
        .or_else(|| streams.iter().find_map(|stream| tag(stream, &["reel_name", "reel", "REEL_NAME", "REEL"])))
        .or_else(|| tag(&format, &["reel_name", "reel", "REEL_NAME", "REEL"]));
    let frame_rate = preferred.and_then(|stream| stream.get("avg_frame_rate").and_then(|value| value.as_str()).or_else(|| stream.get("r_frame_rate").and_then(|value| value.as_str()))).map(str::to_string);
    let field = |name: &str| preferred.and_then(|stream| stream.get(name)).and_then(|value| value.as_str()).map(str::to_string);
    let color_primaries = field("color_primaries");
    let color_transfer = field("color_transfer");
    let color_space = field("color_space");
    let color_range = field("color_range");
    let hdr_format = match color_transfer.as_deref() {
        Some("smpte2084") => Some("pq"),
        Some("arib-std-b67") => Some("hlg"),
        _ if color_primaries.as_deref() == Some("bt2020") => Some("wide-gamut"),
        _ => None,
    };
    let side_data = preferred.and_then(|stream| stream.get("side_data_list")).and_then(|value| value.as_array());
    let content_light = side_data.and_then(|items| items.iter().find(|item| item.get("side_data_type").and_then(|value| value.as_str()).map(|kind| kind.contains("Content light level")).unwrap_or(false)));
    let mastering = side_data.and_then(|items| items.iter().find(|item| item.get("side_data_type").and_then(|value| value.as_str()).map(|kind| kind.contains("Mastering display")).unwrap_or(false)));
    let numeric = |value: Option<&serde_json::Value>| -> Option<f64> {
        let value = value?;
        if let Some(number) = value.as_f64() { return Some(number); }
        let text = value.as_str()?;
        if let Some((numerator, denominator)) = text.split_once('/') {
            let numerator = numerator.parse::<f64>().ok()?;
            let denominator = denominator.parse::<f64>().ok()?;
            if denominator == 0.0 { None } else { Some(numerator / denominator) }
        } else { text.parse::<f64>().ok() }
    };
    let max_content_light_level = content_light.and_then(|item| numeric(item.get("max_content")));
    let max_frame_average_light_level = content_light.and_then(|item| numeric(item.get("max_average")));
    let mastering_display = mastering.map(|item| serde_json::json!({
        "redX": numeric(item.get("red_x")),
        "redY": numeric(item.get("red_y")),
        "greenX": numeric(item.get("green_x")),
        "greenY": numeric(item.get("green_y")),
        "blueX": numeric(item.get("blue_x")),
        "blueY": numeric(item.get("blue_y")),
        "whitePointX": numeric(item.get("white_point_x")),
        "whitePointY": numeric(item.get("white_point_y")),
        "minLuminance": numeric(item.get("min_luminance")),
        "maxLuminance": numeric(item.get("max_luminance"))
    }));
    Ok(serde_json::json!({ "duration": duration, "width": width, "height": height, "videoCodec": video_codec, "audioCodec": audio_codec, "sampleRate": sample_rate, "channels": channels, "audioStreams": audio_streams, "timecode": timecode, "reelName": reel_name, "frameRate": frame_rate, "colorPrimaries": color_primaries, "colorTransfer": color_transfer, "colorSpace": color_space, "colorRange": color_range, "hdrFormat": hdr_format, "hdrMasteringDisplay": mastering_display, "maxContentLightLevel": max_content_light_level, "maxFrameAverageLightLevel": max_frame_average_light_level }))
}

#[tauri::command]
async fn measure_rendered_loudness(app: tauri::AppHandle, output_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(output_path);
        if !source.is_file() { return Err("러드니스 실측 대상 파일을 찾을 수 없습니다.".to_string()); }
        let mut command = media_tool_command(&app, "ffmpeg");
        command.args(["-hide_banner", "-nostats", "-i"]).arg(source).args(["-vn", "-sn", "-dn", "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]);
        let output = command.output().map_err(|error| format!("앱 코덱 엔진으로 EBU R128을 실측하지 못했습니다: {error}"))?;
        let report = String::from_utf8_lossy(&output.stderr);
        let (integrated, loudness_range_lu, true_peak_dbtp) = parse_ebur128_report(&report)?;
        Ok(serde_json::json!({
            "integratedLufs": integrated,
            "loudnessRangeLu": loudness_range_lu,
            "truePeakDbtp": true_peak_dbtp
        }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn apply_broadcast_wav_metadata(app: tauri::AppHandle, output_path: String, sample_rate: u32, time_reference: u64, description: String) -> Result<(), String> {
    if sample_rate != 44_100 && sample_rate != 48_000 && sample_rate != 96_000 { return Err("지원하지 않는 BWF 샘플레이트입니다.".into()); }
    if description.chars().count() > 256 { return Err("BWF 설명이 허용 길이를 초과했습니다.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::fs::canonicalize(&output_path).map_err(|error| format!("BWF 대상 WAV를 찾을 수 없습니다: {error}"))?;
        if !source.is_file() || source.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("wav")).unwrap_or(true) { return Err("BWF 메타데이터 대상은 WAV 파일이어야 합니다.".to_string()); }
        let parent = source.parent().ok_or_else(|| "WAV 상위 폴더를 찾을 수 없습니다.".to_string())?;
        let stem = source.file_stem().and_then(|value| value.to_str()).unwrap_or("cutline-audio");
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
        let temporary = parent.join(format!(".{stem}.cutline-bwf-{nonce}.wav"));
        let backup = parent.join(format!(".{stem}.cutline-bwf-backup-{nonce}.wav"));
        let time_reference_value = time_reference.to_string();
        let time_reference_metadata = format!("time_reference={time_reference_value}");
        let description_metadata = format!("description={description}");
        let mut command = media_tool_command(&app, "ffmpeg");
        let output = command.args(["-y", "-hide_banner", "-loglevel", "error", "-i"]).arg(&source).args([
            "-map", "0:a:0", "-c:a", "copy", "-write_bext", "1", "-metadata", "originator=Cutline", "-metadata",
        ]).arg(&time_reference_metadata).arg("-metadata").arg(&description_metadata).arg(&temporary).output().map_err(|error| format!("BWF 메타데이터 기록기를 실행하지 못했습니다: {error}"))?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("BWF 메타데이터 기록에 실패했습니다: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        if std::fs::metadata(&temporary).map(|metadata| metadata.len() > 64).unwrap_or(false) == false {
            let _ = std::fs::remove_file(&temporary);
            return Err("BWF 결과 파일이 비어 있습니다.".into());
        }
        std::fs::rename(&source, &backup).map_err(|error| format!("기존 WAV를 보존하지 못했습니다: {error}"))?;
        if let Err(error) = std::fs::rename(&temporary, &source) {
            let _ = std::fs::rename(&backup, &source);
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("BWF WAV로 교체하지 못했습니다: {error}"));
        }
        let _ = std::fs::remove_file(&backup);
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn transcode_render_codec(app: tauri::AppHandle, source_path: String, codec: String, bitrate_mbps: u32, audio_sample_rate: Option<u32>, timecode: Option<String>) -> Result<(), String> {
    if codec != "avc" && codec != "hevc" && codec != "prores-422" && codec != "prores-422-hq" && codec != "prores-4444" && codec != "dnxhr-hq" && codec != "dnxhr-hqx" { return Err("지원하지 않는 출력 코덱입니다.".into()); }
    if !(1..=300).contains(&bitrate_mbps) { return Err("출력 비트레이트는 1–300 Mbps 범위여야 합니다.".into()); }
    let audio_sample_rate = audio_sample_rate.unwrap_or(48_000);
    if audio_sample_rate != 44_100 && audio_sample_rate != 48_000 && audio_sample_rate != 96_000 { return Err("지원하지 않는 오디오 샘플레이트입니다.".into()); }
    if let Some(value) = timecode.as_ref() {
        let bytes = value.as_bytes();
        let valid = bytes.len() == 11 && bytes.iter().enumerate().all(|(index, byte)| match index { 2 | 5 => *byte == b':', 8 => *byte == b':' || *byte == b';', _ => byte.is_ascii_digit() });
        if !valid { return Err("출력 타임코드 형식이 올바르지 않습니다.".into()); }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::fs::canonicalize(&source_path).map_err(|error| format!("코덱 변환 대상 파일을 찾을 수 없습니다: {error}"))?;
        if !source.is_file() { return Err("코덱 변환 대상이 파일이 아닙니다.".to_string()); }
        let parent = source.parent().ok_or_else(|| "출력 파일의 상위 폴더를 찾을 수 없습니다.".to_string())?;
        let stem = source.file_stem().and_then(|value| value.to_str()).unwrap_or("cutline-output");
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
        let is_prores = codec.starts_with("prores-");
        let is_dnxhr = codec.starts_with("dnxhr-");
        let is_mezzanine = is_prores || is_dnxhr;
        let source_extension = source.extension().and_then(|value| value.to_str()).unwrap_or(if is_mezzanine { "mov" } else { "mp4" });
        let temporary = parent.join(format!(".{stem}.cutline-transcode-{nonce}.{}", if is_mezzanine { "mov" } else { source_extension }));
        let backup = parent.join(format!(".{stem}.cutline-original-{nonce}.{source_extension}"));
        let video_encoder = if codec == "hevc" { "libx265" } else if is_prores { "prores_ks" } else if is_dnxhr { "dnxhd" } else { "libx264" };
        let bitrate = format!("{}M", bitrate_mbps);
        let maxrate = format!("{}M", bitrate_mbps.saturating_mul(3) / 2);
        let bufsize = format!("{}M", bitrate_mbps.saturating_mul(2));
        let mut command = media_tool_command(&app, "ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error"]);
        if codec == "prores-4444" { command.args(["-c:v", "libvpx-vp9"]); }
        command.arg("-i").arg(&source).args(["-map", "0:v:0", "-map", "0:a:0?", "-c:v", video_encoder]);
        if is_prores {
            let profile = if codec == "prores-4444" { "4" } else if codec == "prores-422-hq" { "3" } else { "2" };
            let pixel_format = if codec == "prores-4444" { "yuva444p10le" } else { "yuv422p10le" };
            let sample_rate = audio_sample_rate.to_string();
            command.args(["-profile:v", profile, "-pix_fmt", pixel_format, "-vendor", "apl0", "-c:a", "pcm_s24le", "-ar", &sample_rate]);
            if let Some(value) = timecode.as_ref() { command.args(["-timecode", value]); }
        } else if is_dnxhr {
            let profile = if codec == "dnxhr-hqx" { "dnxhr_hqx" } else { "dnxhr_hq" };
            let pixel_format = if codec == "dnxhr-hqx" { "yuv422p10le" } else { "yuv422p" };
            let sample_rate = audio_sample_rate.to_string();
            command.args(["-profile:v", profile, "-pix_fmt", pixel_format, "-tag:v", "AVdh", "-c:a", "pcm_s24le", "-ar", &sample_rate]);
            if let Some(value) = timecode.as_ref() { command.args(["-timecode", value]); }
        } else {
            command.args(["-preset", "medium", "-b:v", &bitrate, "-maxrate", &maxrate, "-bufsize", &bufsize, "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart"]);
            if codec == "hevc" { command.args(["-tag:v", "hvc1"]); }
        }
        let output = command.arg(&temporary).output().map_err(|error| format!("앱 코덱 엔진을 실행하지 못했습니다: {error}"))?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("완성 파일 코덱 변환에 실패했습니다: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let valid_output = std::fs::metadata(&temporary).map(|metadata| metadata.len() > 1024).unwrap_or(false);
        if !valid_output {
            let _ = std::fs::remove_file(&temporary);
            return Err("코덱 변환 결과 파일이 비어 있습니다.".into());
        }
        std::fs::rename(&source, &backup).map_err(|error| format!("기존 출력 파일을 보존하지 못했습니다: {error}"))?;
        if let Err(error) = std::fs::rename(&temporary, &source) {
            let _ = std::fs::rename(&backup, &source);
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("변환된 출력 파일을 교체하지 못했습니다: {error}"));
        }
        let _ = std::fs::remove_file(&backup);
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

fn parse_measurement_line(line: &str, label: &str, unit: &str) -> Option<f64> {
    let position = line.rfind(label)?;
    let content = line.get(position + label.len()..)?.trim();
    let value = content.strip_suffix(unit)?.trim();
    if value.eq_ignore_ascii_case("-inf") { return Some(-120.0); }
    value.parse::<f64>().ok()
}

fn parse_ebur128_report(report: &str) -> Result<(f64, f64, f64), String> {
    let mut integrated_lufs: Option<f64> = None;
    let mut loudness_range_lu: Option<f64> = None;
    let mut true_peak_dbtp: Option<f64> = None;
    for line in report.lines() {
        let trimmed = line.trim();
        if let Some(value) = parse_measurement_line(trimmed, "I:", "LUFS") { integrated_lufs = Some(value); }
        if let Some(value) = parse_measurement_line(trimmed, "LRA:", "LU") { loudness_range_lu = Some(value); }
        if let Some(value) = parse_measurement_line(trimmed, "Peak:", "dBFS") { true_peak_dbtp = Some(value); }
    }
    let integrated = integrated_lufs.ok_or_else(|| "완성 파일에서 통합 LUFS를 읽지 못했습니다. 오디오 트랙을 확인해주세요.".to_string())?;
    let range = loudness_range_lu.ok_or_else(|| "완성 파일에서 Loudness Range를 읽지 못했습니다.".to_string())?;
    let peak = true_peak_dbtp.ok_or_else(|| "완성 파일에서 True Peak를 읽지 못했습니다.".to_string())?;
    if !(-120.0..=24.0).contains(&integrated) || !(0.0..=120.0).contains(&range) || !(-120.0..=24.0).contains(&peak) { return Err("완성 파일의 EBU R128 측정값이 허용 범위를 벗어났습니다.".into()); }
    Ok((integrated, range, peak))
}

#[cfg(test)]
mod audio_delivery_tests {
    use super::{parse_ebur128_report, parse_measurement_line};

    #[test]
    fn parses_summary_values_as_lufs_lu_and_dbtp() {
        let report = "Integrated loudness:\n    I:         -23.1 LUFS\nLoudness range:\n    LRA:         4.2 LU\nTrue peak:\n    Peak:       -1.3 dBFS\n";
        assert_eq!(parse_ebur128_report(report).unwrap(), (-23.1, 4.2, -1.3));
    }

    #[test]
    fn uses_final_summary_and_rejects_missing_true_peak() {
        let report = "I: -70.0 LUFS\nI: -14.0 LUFS\nLRA: 2.0 LU\nPeak: -1.0 dBFS";
        assert_eq!(parse_ebur128_report(report).unwrap(), (-14.0, 2.0, -1.0));
        assert!(parse_ebur128_report("I: -14.0 LUFS\nLRA: 2.0 LU").is_err());
        assert_eq!(parse_measurement_line("I: -inf LUFS", "I:", "LUFS"), Some(-120.0));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![app_environment, desktop_stream_conformance_config, authorize_media_paths, authorize_scratch_directory, scratch_disk_usage, clear_scratch_area, find_media_relink_candidates, media_file_signature, reveal_media_in_file_manager, trim_archive_media, codec_toolchain_status, create_ffmpeg_proxy, create_ffmpeg_audio_proxy, create_ffmpeg_image_proxy, create_ffmpeg_image_sequence_proxy, cancel_ffmpeg_proxy, probe_media_metadata, measure_rendered_loudness, apply_broadcast_wav_metadata, transcode_render_codec, mux_render_surround_audio, prepare_render_segment, prepare_render_hdr_raw_segment, decode_render_hdr_source, encode_render_hdr_segment, prepare_render_audio_master, inspect_render_segments, cleanup_render_segments, apply_hdr_output_metadata, verify_update_signature, download_update_installer, prepare_existing_update_installer, launch_verified_update, start_lan_review, sync_lan_review, delete_lan_review_comment, stop_lan_review, acquire_project_lock, heartbeat_project_lock, release_project_lock])
        .run(tauri::generate_context!())
        .expect("failed to run Cutline desktop application");
}
