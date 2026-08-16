use sha2::{Digest, Sha256};
use std::{collections::HashMap, ffi::OsString, fs::File, io::{Read, Write}, path::{Path, PathBuf}, process::Command, sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock}, time::{Duration, SystemTime, UNIX_EPOCH}};

const MAX_INSTALLER_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub fn validate_platform(value: &str) -> Result<(), String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    let compatible = value == "windows-x86_64";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    let compatible = value == "windows-aarch64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let compatible = matches!(value, "macos-x86_64" | "macos-universal");
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let compatible = matches!(value, "macos-aarch64" | "macos-universal");
    #[cfg(not(any(all(target_os = "windows", any(target_arch = "x86_64", target_arch = "aarch64")), all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")))))]
    let compatible = false;
    if !compatible { return Err(format!("업데이트 대상 {value}은 현재 운영체제·아키텍처와 맞지 않습니다.")); }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedInstaller {
    path: String,
    size: u64,
    sha256: String,
    signer: String,
    token: String,
}

#[derive(Clone)]
struct VerifiedInstaller {
    path: PathBuf,
    sha256: String,
    created_at_ms: u128,
}

fn verified_installers() -> &'static Mutex<HashMap<String, VerifiedInstaller>> {
    static INSTALLERS: OnceLock<Mutex<HashMap<String, VerifiedInstaller>>> = OnceLock::new();
    INSTALLERS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn download(download_url: &str, expected_sha256: &str, destination_path: &str) -> Result<DownloadedInstaller, String> {
    validate_sha256(expected_sha256)?;
    let destination = validate_destination(destination_path)?;
    let initial_url = reqwest::Url::parse(download_url).map_err(|_| "업데이트 다운로드 주소 형식이 올바르지 않습니다.".to_string())?;
    validate_download_url(&initial_url)?;
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 { return attempt.error("업데이트 다운로드 리다이렉트가 너무 많습니다."); }
        if validate_download_url(attempt.url()).is_err() { return attempt.error("안전하지 않은 업데이트 리다이렉트입니다."); }
        attempt.follow()
    });
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(30 * 60))
        .redirect(redirect_policy)
        .user_agent("Cutline-Updater/1")
        .build().map_err(|_| "업데이트 다운로드 클라이언트를 만들지 못했습니다.".to_string())?;
    let mut response = client.get(initial_url).send().map_err(|error| format!("업데이트 설치 파일을 다운로드하지 못했습니다: {error}"))?;
    if !response.status().is_success() { return Err(format!("업데이트 설치 파일 서버 응답 오류 ({})", response.status())); }
    if response.content_length().is_some_and(|length| length > MAX_INSTALLER_BYTES) { return Err("업데이트 설치 파일이 2GB 제한을 초과했습니다.".into()); }
    let temporary = temporary_path(&destination);
    let result = write_verified_download(&mut response, &temporary, expected_sha256);
    let (size, actual_sha256) = match result {
        Ok(result) => result,
        Err(error) => { let _ = std::fs::remove_file(&temporary); return Err(error); }
    };
    if destination.exists() && std::fs::remove_file(&destination).is_err() {
        let _ = std::fs::remove_file(&temporary);
        return Err("선택한 기존 설치 파일을 교체하지 못했습니다.".into());
    }
    std::fs::rename(&temporary, &destination).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        format!("검증된 설치 파일을 선택한 위치로 옮기지 못했습니다: {error}")
    })?;
    let signer = match verify_platform_signature(&destination) {
        Ok(signer) => signer,
        Err(error) => { let _ = std::fs::remove_file(&destination); return Err(error); }
    };
    let token = register_verified_installer(&destination, &actual_sha256)?;
    Ok(DownloadedInstaller { path: destination.to_string_lossy().to_string(), size, sha256: actual_sha256, signer, token })
}

pub fn prepare_existing(expected_sha256: &str, installer_path: &str) -> Result<DownloadedInstaller, String> {
    validate_sha256(expected_sha256)?;
    let installer = PathBuf::from(installer_path);
    validate_installer_extension(&installer)?;
    let metadata = std::fs::metadata(&installer).map_err(|_| "기존 업데이트 설치 파일을 찾지 못했습니다.".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_INSTALLER_BYTES { return Err("기존 업데이트 설치 파일 크기가 올바르지 않습니다.".into()); }
    let actual_sha256 = hash_file(&installer)?;
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) { return Err("기존 업데이트 설치 파일의 SHA-256이 서명 매니페스트와 다릅니다.".into()); }
    let signer = verify_platform_signature(&installer)?;
    let token = register_verified_installer(&installer, &actual_sha256)?;
    Ok(DownloadedInstaller { path: installer.to_string_lossy().to_string(), size: metadata.len(), sha256: actual_sha256, signer, token })
}

pub fn launch(token: &str) -> Result<(), String> {
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err("업데이트 실행 토큰 형식이 올바르지 않습니다.".into()); }
    let record = verified_installers().lock().map_err(|_| "업데이트 실행 기록 잠금을 얻지 못했습니다.".to_string())?.remove(token).ok_or_else(|| "검증된 업데이트 실행 기록이 없거나 이미 사용됐습니다.".to_string())?;
    if now_ms().saturating_sub(record.created_at_ms) > 30 * 60 * 1000 { return Err("업데이트 실행 승인이 30분을 지나 만료됐습니다.".into()); }
    let installer = record.path;
    validate_installer_extension(&installer)?;
    let metadata = std::fs::metadata(&installer).map_err(|_| "검증된 업데이트 설치 파일을 찾지 못했습니다.".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_INSTALLER_BYTES { return Err("업데이트 설치 파일 크기가 올바르지 않습니다.".into()); }
    let actual = hash_file(&installer)?;
    if !actual.eq_ignore_ascii_case(&record.sha256) { return Err("실행 직전 업데이트 설치 파일의 SHA-256이 달라졌습니다.".into()); }
    verify_platform_signature(&installer)?;
    #[cfg(target_os = "windows")]
    {
        let extension = installer.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        if extension == "msi" {
            Command::new("msiexec.exe").arg("/i").arg(&installer).spawn().map_err(|_| "Windows Installer를 실행하지 못했습니다.".to_string())?;
        } else {
            Command::new(&installer).spawn().map_err(|_| "업데이트 설치 파일을 실행하지 못했습니다.".to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&installer).spawn().map_err(|_| "업데이트 설치 이미지를 열지 못했습니다.".to_string())?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return Err("업데이트 설치 실행은 Windows와 macOS에서만 지원합니다.".into());
    Ok(())
}

fn write_verified_download(response: &mut reqwest::blocking::Response, path: &Path, expected_sha256: &str) -> Result<(u64, String), String> {
    let mut file = File::create(path).map_err(|_| "업데이트 임시 파일을 만들지 못했습니다.".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let count = response.read(&mut buffer).map_err(|_| "업데이트 설치 파일 다운로드가 중단되었습니다.".to_string())?;
        if count == 0 { break; }
        total = total.saturating_add(count as u64);
        if total > MAX_INSTALLER_BYTES { return Err("업데이트 설치 파일이 2GB 제한을 초과했습니다.".into()); }
        file.write_all(&buffer[..count]).map_err(|_| "업데이트 설치 파일을 디스크에 쓰지 못했습니다.".to_string())?;
        hasher.update(&buffer[..count]);
    }
    file.sync_all().map_err(|_| "업데이트 설치 파일을 디스크에 확정하지 못했습니다.".to_string())?;
    if total == 0 { return Err("업데이트 설치 파일이 비어 있습니다.".into()); }
    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) { return Err(format!("업데이트 설치 파일 SHA-256이 다릅니다. 예상 {expected_sha256}, 실제 {actual}")); }
    Ok((total, actual))
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "업데이트 설치 파일을 읽지 못했습니다.".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "업데이트 설치 파일 해시를 계산하지 못했습니다.".to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_destination(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    validate_installer_extension(&path)?;
    let parent = path.parent().ok_or_else(|| "업데이트 저장 폴더가 올바르지 않습니다.".to_string())?;
    if !parent.is_dir() { return Err("업데이트 저장 폴더를 찾지 못했습니다.".into()); }
    Ok(path)
}

fn validate_installer_extension(path: &Path) -> Result<(), String> {
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    #[cfg(target_os = "windows")]
    let allowed = matches!(extension.as_str(), "exe" | "msi");
    #[cfg(target_os = "macos")]
    let allowed = matches!(extension.as_str(), "dmg" | "pkg");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let allowed = false;
    if !allowed { return Err("현재 운영체제에서 허용되는 업데이트 설치 파일 확장자가 아닙니다.".into()); }
    Ok(())
}

fn validate_download_url(url: &reqwest::Url) -> Result<(), String> {
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) { return Err("업데이트 설치 파일 주소는 HTTPS여야 합니다.".into()); }
    if !url.username().is_empty() || url.password().is_some() { return Err("업데이트 설치 파일 주소에는 사용자 정보를 포함할 수 없습니다.".into()); }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err("업데이트 설치 파일 SHA-256 형식이 올바르지 않습니다.".into()); }
    Ok(())
}

fn temporary_path(destination: &Path) -> PathBuf {
    let mut value = OsString::from(destination.as_os_str());
    value.push(format!(".cutline-{}.part", std::process::id()));
    PathBuf::from(value)
}

fn register_verified_installer(path: &Path, sha256: &str) -> Result<String, String> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nonce = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().to_string_lossy().as_bytes());
    hasher.update(sha256.as_bytes());
    hasher.update(now_ms().to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(nonce.to_le_bytes());
    let token = format!("{:x}", hasher.finalize());
    let mut records = verified_installers().lock().map_err(|_| "업데이트 실행 기록 잠금을 얻지 못했습니다.".to_string())?;
    let cutoff = now_ms().saturating_sub(30 * 60 * 1000);
    records.retain(|_, record| record.created_at_ms >= cutoff);
    records.insert(token.clone(), VerifiedInstaller { path: path.to_path_buf(), sha256: sha256.to_string(), created_at_ms: now_ms() });
    Ok(token)
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

fn verify_platform_signature(path: &Path) -> Result<String, String> {
    if cfg!(debug_assertions) && option_env!("CUTLINE_ALLOW_UNSIGNED_UPDATES") == Some("1") { return Ok("DEBUG UNSIGNED OVERRIDE".into()); }
    #[cfg(target_os = "windows")]
    return verify_windows_authenticode(path);
    #[cfg(target_os = "macos")]
    return verify_macos_signature(path);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("업데이트 코드 서명 검증은 Windows와 macOS에서만 지원합니다.".into())
}

#[cfg(target_os = "windows")]
fn verify_windows_authenticode(path: &Path) -> Result<String, String> {
    let system_root = std::env::var_os("SystemRoot").ok_or_else(|| "Windows 시스템 경로를 찾지 못했습니다.".to_string())?;
    let powershell = PathBuf::from(system_root).join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    if !powershell.is_file() { return Err("Windows Authenticode 검사기를 찾지 못했습니다.".into()); }
    let script = "$s=Get-AuthenticodeSignature -LiteralPath $env:CUTLINE_INSTALLER_PATH; [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::WriteLine($s.Status.ToString()); if ($null -ne $s.SignerCertificate) {[Console]::WriteLine($s.SignerCertificate.Subject)}";
    let mut command = Command::new(powershell);
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]).env("CUTLINE_INSTALLER_PATH", path);
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
    let output = command.output().map_err(|_| "Windows Authenticode 검사를 실행하지 못했습니다.".to_string())?;
    if !output.status.success() { return Err("Windows Authenticode 검사 명령이 실패했습니다.".into()); }
    let report = String::from_utf8_lossy(&output.stdout);
    let mut lines = report.lines().map(str::trim).filter(|line| !line.is_empty());
    if lines.next().map(|line| line.trim_start_matches('\u{feff}')) != Some("Valid") { return Err("업데이트 설치 파일의 Windows Authenticode 서명이 유효하지 않습니다.".into()); }
    let signer = lines.collect::<Vec<_>>().join(" ");
    if signer.is_empty() { return Err("업데이트 설치 파일의 Windows 서명자를 읽지 못했습니다.".into()); }
    require_expected_signer(&signer, "CUTLINE_UPDATE_SIGNER_SUBJECT")?;
    Ok(signer)
}

#[cfg(target_os = "macos")]
fn verify_macos_signature(path: &Path) -> Result<String, String> {
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    let report = if extension == "pkg" {
        let signature = Command::new("/usr/sbin/pkgutil").arg("--check-signature").arg(path).output().map_err(|_| "macOS PKG 서명 검사를 실행하지 못했습니다.".to_string())?;
        if !signature.status.success() { return Err("업데이트 PKG의 Developer ID Installer 서명이 유효하지 않습니다.".into()); }
        let gatekeeper = Command::new("/usr/sbin/spctl").args(["--assess", "--type", "install", "--verbose=4"]).arg(path).output().map_err(|_| "macOS Gatekeeper 검사를 실행하지 못했습니다.".to_string())?;
        if !gatekeeper.status.success() { return Err("업데이트 PKG가 Gatekeeper 설치 검사를 통과하지 못했습니다.".into()); }
        format!("{}\n{}", String::from_utf8_lossy(&signature.stdout), String::from_utf8_lossy(&signature.stderr))
    } else {
        let verify = Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict", "--verbose=2"]).arg(path).output().map_err(|_| "macOS DMG 코드 서명 검사를 실행하지 못했습니다.".to_string())?;
        if !verify.status.success() { return Err("업데이트 DMG의 Developer ID Application 서명이 유효하지 않습니다.".into()); }
        let details = Command::new("/usr/bin/codesign").args(["-dv", "--verbose=4"]).arg(path).output().map_err(|_| "macOS DMG 서명 정보를 읽지 못했습니다.".to_string())?;
        let gatekeeper = Command::new("/usr/sbin/spctl").args(["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4"]).arg(path).output().map_err(|_| "macOS Gatekeeper 검사를 실행하지 못했습니다.".to_string())?;
        if !gatekeeper.status.success() { return Err("업데이트 DMG가 Gatekeeper 공증 검사를 통과하지 못했습니다.".into()); }
        format!("{}\n{}", String::from_utf8_lossy(&details.stdout), String::from_utf8_lossy(&details.stderr))
    };
    let expected_team = option_env!("CUTLINE_UPDATE_APPLE_TEAM_ID").map(str::trim).filter(|value| !value.is_empty());
    if expected_team.is_none() && !cfg!(debug_assertions) { return Err("릴리스 앱에 Apple Team ID가 포함되지 않았습니다.".into()); }
    if let Some(team) = expected_team {
        if !report.to_ascii_lowercase().contains(&team.to_ascii_lowercase()) { return Err("업데이트 설치 파일의 Apple Team ID가 허용된 팀과 다릅니다.".into()); }
    }
    Ok(report.lines().map(str::trim).find(|line| line.contains("Developer ID") || line.contains("Authority=")).unwrap_or("Apple Developer ID verified").chars().take(240).collect())
}

#[cfg(target_os = "windows")]
fn require_expected_signer(actual: &str, _environment_name: &str) -> Result<(), String> {
    let expected = option_env!("CUTLINE_UPDATE_SIGNER_SUBJECT").map(str::trim).filter(|value| !value.is_empty());
    if expected.is_none() && !cfg!(debug_assertions) { return Err("릴리스 앱에 Windows 업데이트 서명자 이름이 포함되지 않았습니다.".into()); }
    if let Some(expected) = expected {
        if !actual.to_ascii_lowercase().contains(&expected.to_ascii_lowercase()) { return Err("업데이트 설치 파일의 Windows 서명자가 허용된 게시자와 다릅니다.".into()); }
    }
    Ok(())
}
