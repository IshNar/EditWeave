use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

pub fn verify(public_key: &str, signature: &str, payload: &str) -> Result<bool, String> {
    if public_key.len() > 100 || signature.len() > 120 || payload.len() > 16_384 {
        return Err("업데이트 서명 입력이 허용 크기를 초과했습니다.".into());
    }
    let public_key = decode_base64(public_key, "업데이트 공개 키")?;
    let signature = decode_base64(signature, "업데이트 서명")?;
    let public_key: [u8; 32] = public_key.try_into().map_err(|_| "Ed25519 업데이트 공개 키는 32바이트여야 합니다.".to_string())?;
    let signature = Signature::from_slice(&signature).map_err(|_| "Ed25519 업데이트 서명은 64바이트여야 합니다.".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|_| "Ed25519 업데이트 공개 키가 올바르지 않습니다.".to_string())?;
    Ok(verifying_key.verify(payload.as_bytes(), &signature).is_ok())
}

pub fn verify_trusted(provided_public_key: &str, signature: &str, payload: &str) -> Result<bool, String> {
    let trusted = match option_env!("CUTLINE_UPDATE_PUBLIC_KEY") {
        Some(value) if !value.trim().is_empty() => {
            if compact_base64(value) != compact_base64(provided_public_key) { return Err("앱에 고정된 업데이트 공개 키와 요청 키가 다릅니다.".into()); }
            value
        }
        _ if cfg!(debug_assertions) => provided_public_key,
        _ => return Err("릴리스 앱에 네이티브 업데이트 공개 키가 포함되지 않았습니다.".into()),
    };
    verify(trusted, signature, payload)
}

fn decode_base64(value: &str, label: &str) -> Result<Vec<u8>, String> {
    let compact = compact_base64(value);
    for engine in [&general_purpose::STANDARD, &general_purpose::STANDARD_NO_PAD, &general_purpose::URL_SAFE, &general_purpose::URL_SAFE_NO_PAD] {
        if let Ok(decoded) = engine.decode(&compact) { return Ok(decoded); }
    }
    Err(format!("{label} Base64 형식이 올바르지 않습니다."))
}

fn compact_base64(value: &str) -> String {
    value.chars().filter(|character| !character.is_ascii_whitespace()).collect()
}
