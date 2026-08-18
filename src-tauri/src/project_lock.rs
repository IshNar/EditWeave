use std::{fs::OpenOptions, io::Write, path::{Path, PathBuf}};

const STALE_AFTER_MS: u64 = 45_000;

fn lock_path(project_path: &Path) -> Result<PathBuf, String> {
    let name = project_path.file_name().and_then(|value| value.to_str()).ok_or_else(|| "프로젝트 파일 이름이 올바르지 않습니다.".to_string())?;
    Ok(project_path.with_file_name(format!(".{name}.editweave-lock")))
}

fn owner(instance_id: &str, now_ms: u64) -> serde_json::Value {
    serde_json::json!({
        "schema": "editweave-project-lock-v1",
        "instanceId": instance_id,
        "user": std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "unknown".into()),
        "host": std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "unknown".into()),
        "processId": std::process::id(),
        "acquiredAtMs": now_ms,
        "heartbeatAtMs": now_ms
    })
}

pub fn acquire(project_path: &str, instance_id: &str, now_ms: u64, force: bool) -> Result<serde_json::Value, String> {
    validate_instance(instance_id)?;
    let project = PathBuf::from(project_path);
    let parent = project.parent().ok_or_else(|| "프로젝트 폴더를 찾을 수 없습니다.".to_string())?;
    if !parent.is_dir() { return Err("프로젝트 폴더가 존재하지 않습니다.".into()); }
    let path = lock_path(&project)?;
    let lock_file_exists = path.is_file();
    let existing = read_lock(&path);
    if let Some(current) = existing.as_ref() {
        if current.get("instanceId").and_then(|value| value.as_str()) == Some(instance_id) {
            let next = refresh_owner(current.clone(), now_ms);
            write_lock(&path, &next, false)?;
            return Ok(serde_json::json!({ "acquired": true, "lockPath": path, "owner": next }));
        }
        let heartbeat = current.get("heartbeatAtMs").and_then(|value| value.as_u64()).unwrap_or(0);
        let stale = now_ms.saturating_sub(heartbeat) > STALE_AFTER_MS;
        if !force { return Ok(serde_json::json!({ "acquired": false, "stale": stale, "lockPath": path, "owner": current })); }
    } else if lock_file_exists && !force {
        return Ok(serde_json::json!({ "acquired": false, "stale": true, "lockPath": path, "owner": { "instanceId": "unknown", "user": "unknown", "host": "unknown", "processId": 0, "acquiredAtMs": 0, "heartbeatAtMs": 0 } }));
    }
    let next = owner(instance_id, now_ms);
    if lock_file_exists {
        write_lock(&path, &next, false)?;
    } else {
        write_lock(&path, &next, true)?;
    }
    Ok(serde_json::json!({ "acquired": true, "stale": existing.as_ref().map(|current| now_ms.saturating_sub(current.get("heartbeatAtMs").and_then(|value| value.as_u64()).unwrap_or(0)) > STALE_AFTER_MS).unwrap_or(lock_file_exists), "lockPath": path, "owner": next }))
}

pub fn heartbeat(project_path: &str, instance_id: &str, now_ms: u64) -> Result<bool, String> {
    let path = lock_path(Path::new(project_path))?;
    let Some(current) = read_lock(&path) else { return Ok(false); };
    if current.get("instanceId").and_then(|value| value.as_str()) != Some(instance_id) { return Ok(false); }
    write_lock(&path, &refresh_owner(current, now_ms), false)?;
    Ok(true)
}

pub fn release(project_path: &str, instance_id: &str) -> Result<(), String> {
    let path = lock_path(Path::new(project_path))?;
    let Some(current) = read_lock(&path) else { return Ok(()); };
    if current.get("instanceId").and_then(|value| value.as_str()) == Some(instance_id) { std::fs::remove_file(path).map_err(|error| error.to_string())?; }
    Ok(())
}

fn validate_instance(value: &str) -> Result<(), String> {
    if !(16..=100).contains(&value.len()) || !value.chars().all(|character| character.is_ascii_alphanumeric() || character == '-') { return Err("프로젝트 잠금 instance ID가 올바르지 않습니다.".into()); }
    Ok(())
}

fn read_lock(path: &Path) -> Option<serde_json::Value> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 16_384 { return None; }
    serde_json::from_slice(&bytes).ok()
}

fn refresh_owner(mut current: serde_json::Value, now_ms: u64) -> serde_json::Value {
    current["heartbeatAtMs"] = serde_json::Value::Number(now_ms.into());
    current
}

fn write_lock(path: &Path, value: &serde_json::Value, create_new: bool) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.write(true);
    if create_new { options.create_new(true); } else { options.create(true).truncate(true); }
    let mut file = options.open(path).map_err(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { "다른 편집자가 동시에 프로젝트 잠금을 만들었습니다.".into() } else { error.to_string() })?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}
