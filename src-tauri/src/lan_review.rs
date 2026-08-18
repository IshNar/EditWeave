use std::{collections::HashMap, io::{Read, Seek, SeekFrom, Write}, net::{TcpListener, TcpStream, UdpSocket}, path::PathBuf, sync::{Arc, Mutex, OnceLock}, time::Duration};

#[derive(Clone)]
struct ReviewSession {
    project_name: String,
    sequence_id: String,
    video_path: PathBuf,
    comments: Vec<serde_json::Value>,
}

struct ReviewServer {
    port: u16,
    host: String,
    sessions: Arc<Mutex<HashMap<String, ReviewSession>>>,
}

static SERVER: OnceLock<ReviewServer> = OnceLock::new();

pub fn start(token: String, project_name: String, sequence_id: String, video_path: String, comments: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    validate_token(&token)?;
    let video_path = PathBuf::from(video_path);
    if !video_path.is_file() || video_path.metadata().map(|metadata| metadata.len() < 512).unwrap_or(true) { return Err("검토용 MP4 파일을 찾을 수 없거나 파일이 비어 있습니다.".into()); }
    if video_path.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("mp4")).unwrap_or(true) { return Err("LAN 검토 링크는 MP4 영상만 지원합니다.".into()); }
    let server = ensure_server()?;
    let mut sessions = server.sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?;
    if sessions.len() >= 16 && !sessions.contains_key(&token) { return Err("동시에 열 수 있는 LAN 검토 세션은 16개입니다.".into()); }
    sessions.insert(token.clone(), ReviewSession {
        project_name: project_name.chars().take(200).collect(),
        sequence_id: sequence_id.chars().take(200).collect(),
        video_path,
        comments: sanitize_comments(comments),
    });
    Ok(serde_json::json!({ "token": token, "url": format!("http://{}:{}/review/{}", server.host, server.port, token), "port": server.port }))
}

pub fn sync(token: &str, comments: Vec<serde_json::Value>, deleted_ids: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    validate_token(token)?;
    let server = SERVER.get().ok_or_else(|| "LAN 검토 서버가 실행 중이 아닙니다.".to_string())?;
    let mut sessions = server.sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?;
    let session = sessions.get_mut(token).ok_or_else(|| "LAN 검토 세션을 찾을 수 없습니다.".to_string())?;
    merge_comments(&mut session.comments, sanitize_comments(comments));
    if !deleted_ids.is_empty() {
        session.comments.retain(|comment| !deleted_ids.iter().any(|id| comment.get("id").and_then(|value| value.as_str()) == Some(id.as_str())));
    }
    Ok(session.comments.clone())
}

pub fn delete_comment(token: &str, comment_id: &str) -> Result<(), String> {
    let server = SERVER.get().ok_or_else(|| "LAN 검토 서버가 실행 중이 아닙니다.".to_string())?;
    let mut sessions = server.sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?;
    let session = sessions.get_mut(token).ok_or_else(|| "LAN 검토 세션을 찾을 수 없습니다.".to_string())?;
    session.comments.retain(|comment| comment.get("id").and_then(|value| value.as_str()) != Some(comment_id));
    Ok(())
}

pub fn stop(token: &str) -> Result<(), String> {
    if let Some(server) = SERVER.get() {
        server.sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?.remove(token);
    }
    Ok(())
}

fn ensure_server() -> Result<&'static ReviewServer, String> {
    if let Some(server) = SERVER.get() { return Ok(server); }
    let listener = TcpListener::bind(("0.0.0.0", 0)).map_err(|error| format!("LAN 검토 포트를 열지 못했습니다: {error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let worker_sessions = sessions.clone();
    std::thread::Builder::new().name("editweave-lan-review".into()).spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue; };
            let sessions = worker_sessions.clone();
            let _ = std::thread::Builder::new().name("editweave-review-client".into()).spawn(move || { let _ = handle_request(stream, sessions); });
        }
    }).map_err(|error| error.to_string())?;
    let server = ReviewServer { port, host: local_ip(), sessions };
    let _ = SERVER.set(server);
    SERVER.get().ok_or_else(|| "LAN 검토 서버 초기화에 실패했습니다.".to_string())
}

fn local_ip() -> String {
    UdpSocket::bind(("0.0.0.0", 0)).ok().and_then(|socket| {
        socket.connect(("1.1.1.1", 80)).ok()?;
        socket.local_addr().ok().map(|address| address.ip().to_string())
    }).unwrap_or_else(|| "127.0.0.1".into())
}

fn validate_token(token: &str) -> Result<(), String> {
    if !(16..=100).contains(&token.len()) || !token.chars().all(|character| character.is_ascii_alphanumeric() || character == '-') { return Err("유효하지 않은 LAN 검토 토큰입니다.".into()); }
    Ok(())
}

fn handle_request(mut stream: TcpStream, sessions: Arc<Mutex<HashMap<String, ReviewSession>>>) -> Result<(), String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    let mut request = Vec::new();
    let mut buffer = [0u8; 8192];
    let header_end = loop {
        let count = stream.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { return Ok(()); }
        request.extend_from_slice(&buffer[..count]);
        if request.len() > 4_200_000 { return send_text(&mut stream, 413, "text/plain; charset=utf-8", "요청이 너무 큽니다."); }
        if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") { break position + 4; }
    };
    let header = String::from_utf8_lossy(&request[..header_end]).into_owned();
    let mut lines = header.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default().split('?').next().unwrap_or_default();
    let headers: HashMap<String, String> = lines.filter_map(|line| line.split_once(':')).map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string())).collect();
    let length = headers.get("content-length").and_then(|value| value.parse::<usize>().ok()).unwrap_or(0);
    if length > 4_000_000 { return send_text(&mut stream, 413, "text/plain; charset=utf-8", "요청이 너무 큽니다."); }
    while request.len() < header_end + length {
        let count = stream.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        request.extend_from_slice(&buffer[..count]);
        if request.len() > 4_200_000 { return send_text(&mut stream, 413, "text/plain; charset=utf-8", "요청이 너무 큽니다."); }
    }
    let body_end = (header_end + length).min(request.len());
    let body = &request[header_end..body_end];
    if method == "GET" {
        if let Some(token) = path.strip_prefix("/review/") { validate_token(token)?; return send_text(&mut stream, 200, "text/html; charset=utf-8", &review_html(token)); }
        if let Some(token) = path.strip_prefix("/api/review/") { return send_session_json(&mut stream, &sessions, token); }
        if let Some(token) = path.strip_prefix("/media/") { return send_video(&mut stream, &sessions, token, headers.get("range")); }
    }
    if method == "POST" {
        if let Some(token) = path.strip_prefix("/api/review/") { return update_session_json(&mut stream, &sessions, token, body); }
    }
    send_text(&mut stream, 404, "text/plain; charset=utf-8", "찾을 수 없습니다.")
}

fn send_session_json(stream: &mut TcpStream, sessions: &Arc<Mutex<HashMap<String, ReviewSession>>>, token: &str) -> Result<(), String> {
    validate_token(token)?;
    let sessions = sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?;
    let Some(session) = sessions.get(token) else { return send_text(stream, 404, "text/plain; charset=utf-8", "종료된 검토 세션입니다."); };
    let body = serde_json::to_string(&serde_json::json!({ "projectName": &session.project_name, "sequenceId": &session.sequence_id, "comments": &session.comments })).map_err(|error| error.to_string())?;
    send_text(stream, 200, "application/json; charset=utf-8", &body)
}

fn update_session_json(stream: &mut TcpStream, sessions: &Arc<Mutex<HashMap<String, ReviewSession>>>, token: &str, body: &[u8]) -> Result<(), String> {
    validate_token(token)?;
    let value: serde_json::Value = serde_json::from_slice(body).map_err(|_| "검토 코멘트 JSON이 올바르지 않습니다.".to_string())?;
    let incoming = value.get("comments").and_then(|value| value.as_array()).cloned().unwrap_or_default();
    let mut sessions = sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?;
    let Some(session) = sessions.get_mut(token) else { return send_text(stream, 404, "text/plain; charset=utf-8", "종료된 검토 세션입니다."); };
    merge_comments(&mut session.comments, sanitize_comments(incoming));
    let response = serde_json::to_string(&serde_json::json!({ "comments": &session.comments })).map_err(|error| error.to_string())?;
    send_text(stream, 200, "application/json; charset=utf-8", &response)
}

fn sanitize_comments(comments: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    comments.into_iter().filter_map(|comment| {
        let object = comment.as_object()?;
        if object.get("kind").and_then(|value| value.as_str()) != Some("comment") { return None; }
        let id: String = object.get("id")?.as_str()?.chars().take(160).collect();
        let label: String = object.get("label")?.as_str()?.chars().take(2_000).collect();
        let time = object.get("time")?.as_f64().filter(|value| value.is_finite())?.max(0.0);
        let mut clean = serde_json::json!({
            "id": id, "time": time, "label": label, "kind": "comment", "color": "#59c9a5",
            "status": if object.get("status").and_then(|value| value.as_str()) == Some("resolved") { "resolved" } else { "open" }
        });
        for field in ["author", "createdAt", "updatedAt"] {
            if let Some(value) = object.get(field).and_then(|value| value.as_str()) { clean[field] = serde_json::Value::String(value.chars().take(160).collect()); }
        }
        Some(clean)
    }).take(10_000).collect()
}

fn merge_comments(current: &mut Vec<serde_json::Value>, incoming: Vec<serde_json::Value>) {
    let mut positions: HashMap<String, usize> = current.iter().enumerate().filter_map(|(index, value)| Some((value.get("id")?.as_str()?.to_string(), index))).collect();
    for comment in incoming {
        let Some(id) = comment.get("id").and_then(|value| value.as_str()).map(str::to_string) else { continue; };
        if let Some(index) = positions.get(&id).copied() {
            let incoming_revision = comment.get("updatedAt").and_then(|value| value.as_str()).or_else(|| comment.get("createdAt").and_then(|value| value.as_str())).unwrap_or_default();
            let current_revision = current[index].get("updatedAt").and_then(|value| value.as_str()).or_else(|| current[index].get("createdAt").and_then(|value| value.as_str())).unwrap_or_default();
            if incoming_revision >= current_revision { current[index] = comment; }
        } else {
            positions.insert(id, current.len());
            current.push(comment);
        }
    }
    current.sort_by(|left, right| left.get("time").and_then(|value| value.as_f64()).unwrap_or_default().total_cmp(&right.get("time").and_then(|value| value.as_f64()).unwrap_or_default()));
}

fn send_video(stream: &mut TcpStream, sessions: &Arc<Mutex<HashMap<String, ReviewSession>>>, token: &str, range: Option<&String>) -> Result<(), String> {
    validate_token(token)?;
    let path = {
        let sessions = sessions.lock().map_err(|_| "LAN 검토 세션 잠금 오류".to_string())?;
        let Some(session) = sessions.get(token) else { return send_text(stream, 404, "text/plain; charset=utf-8", "종료된 검토 세션입니다."); };
        session.video_path.clone()
    };
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    let (start, end, partial) = parse_range(range.map(String::as_str), size);
    let count = end.saturating_sub(start).saturating_add(1);
    let status = if partial { "206 Partial Content" } else { "200 OK" };
    let content_range = if partial { format!("Content-Range: bytes {start}-{end}/{size}\r\n") } else { String::new() };
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: video/mp4\r\nContent-Length: {count}\r\nAccept-Ranges: bytes\r\n{content_range}Cache-Control: no-store\r\nConnection: close\r\n\r\n");
    stream.write_all(header.as_bytes()).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(start)).map_err(|error| error.to_string())?;
    let mut remaining = count;
    let mut chunk = [0u8; 64 * 1024];
    while remaining > 0 {
        let chunk_length = remaining.min(chunk.len() as u64) as usize;
        let read = file.read(&mut chunk[..chunk_length]).map_err(|error| error.to_string())?;
        if read == 0 { break; }
        stream.write_all(&chunk[..read]).map_err(|error| error.to_string())?;
        remaining -= read as u64;
    }
    Ok(())
}

fn parse_range(range: Option<&str>, size: u64) -> (u64, u64, bool) {
    if size == 0 { return (0, 0, false); }
    let Some(value) = range.and_then(|value| value.strip_prefix("bytes=")) else { return (0, size - 1, false); };
    let Some((start, end)) = value.split_once('-') else { return (0, size - 1, false); };
    let Ok(start) = start.parse::<u64>() else { return (0, size - 1, false); };
    let end = end.parse::<u64>().unwrap_or(size - 1).min(size - 1);
    if start > end || start >= size { return (0, size - 1, false); }
    (start, end, true)
}

fn send_text(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) -> Result<(), String> {
    let reason = match status { 200 => "OK", 404 => "Not Found", 413 => "Payload Too Large", _ => "Bad Request" };
    let response = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}", body.as_bytes().len());
    stream.write_all(response.as_bytes()).map_err(|error| error.to_string())
}

fn review_html(token: &str) -> String {
    let page = r#"<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EditWeave Review</title><style>*{box-sizing:border-box}body{margin:0;background:#0c0c12;color:#e9e7ef;font:14px system-ui,sans-serif}.shell{max-width:1100px;margin:auto;padding:24px}.brand{color:#9c84ff;font-weight:800}.grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,1fr);gap:18px;margin-top:16px}video{width:100%;max-height:72vh;background:#000;border:1px solid #302d3d;border-radius:12px}.side{border:1px solid #302d3d;border-radius:12px;background:#14131b;overflow:hidden}h1{font-size:17px;margin:5px 0}.compose{display:grid;grid-template-columns:92px 1fr auto;gap:7px;padding:12px;border-bottom:1px solid #292733}.compose input,.comment input{min-width:0;border:1px solid #34313f;border-radius:6px;background:#0f0f15;color:#eee;padding:9px}.compose button,.comment button{border:1px solid #5c47aa;border-radius:6px;background:#2b2149;color:#d8d0ff;padding:8px}.list{max-height:65vh;overflow:auto;padding:10px}.comment{display:grid;grid-template-columns:70px 1fr auto;gap:7px;align-items:center;padding:9px 3px;border-bottom:1px solid #292733}.time{color:#69d6b4}.meta{display:block;color:#777382;font-size:11px;margin-top:4px}.resolved{opacity:.5}.note{color:#8b8797;font-size:12px}@media(max-width:760px){.grid{grid-template-columns:1fr}.compose{grid-template-columns:1fr 1fr}.compose button{grid-column:span 2}}</style></head><body><main class="shell"><span class="brand">EDITWEAVE REVIEW</span><h1 id="title">검토 세션 불러오는 중…</h1><p class="note">이 링크는 편집자의 같은 LAN에서만 열립니다. 영상은 편집자 컴퓨터에서 직접 스트리밍됩니다.</p><div class="grid"><video id="video" controls preload="metadata" src="/media/__TOKEN__"></video><section class="side"><form id="form" class="compose"><input id="author" value="검토자" maxlength="120"><input id="label" placeholder="현재 시점에 의견 남기기" maxlength="2000"><button>추가</button></form><div id="list" class="list"></div></section></div></main><script>const token='__TOKEN__',video=document.querySelector('#video'),list=document.querySelector('#list'),form=document.querySelector('#form');let comments=[];const escTime=s=>{s=Math.max(0,s);const h=Math.floor(s/3600),m=Math.floor(s/60)%60,sec=Math.floor(s)%60;return [h,m,sec].map(v=>String(v).padStart(2,'0')).join(':')};const makeId=()=>globalThis.crypto?.randomUUID?.()||'review-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);async function save(){const r=await fetch('/api/review/'+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({comments})});if(r.ok){comments=(await r.json()).comments;render()}}function render(){list.replaceChildren(...comments.map(c=>{const row=document.createElement('div');row.className='comment '+(c.status==='resolved'?'resolved':'');const time=document.createElement('button');time.className='time';time.textContent=escTime(c.time);time.onclick=()=>video.currentTime=c.time;const body=document.createElement('div'),input=document.createElement('input'),meta=document.createElement('small');input.value=c.label;input.onchange=()=>{c.label=input.value;c.updatedAt=new Date().toISOString();save()};meta.className='meta';meta.textContent=(c.author||'검토자')+' · '+new Date(c.createdAt||0).toLocaleString();body.append(input,meta);const done=document.createElement('button');done.textContent=c.status==='resolved'?'다시 열기':'해결';done.onclick=()=>{c.status=c.status==='resolved'?'open':'resolved';c.updatedAt=new Date().toISOString();save()};row.append(time,body,done);return row}))}async function load(){const r=await fetch('/api/review/'+token);if(!r.ok)return;const data=await r.json();document.querySelector('#title').textContent=data.projectName;comments=data.comments;render()}form.onsubmit=e=>{e.preventDefault();const label=document.querySelector('#label'),author=document.querySelector('#author');if(!label.value.trim())return;comments.push({id:makeId(),time:video.currentTime,label:label.value.trim(),color:'#59c9a5',kind:'comment',status:'open',author:author.value.trim()||'검토자',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});label.value='';save()};load();setInterval(load,3000)</script></body></html>"#;
    page.replace("__TOKEN__", token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, net::TcpStream, time::{SystemTime, UNIX_EPOCH}};

    fn request(port: u16, request: &str) -> String {
        let mut stream = (0..50).find_map(|_| {
            TcpStream::connect(("127.0.0.1", port)).ok().or_else(|| {
                std::thread::sleep(Duration::from_millis(10));
                None
            })
        }).expect("LAN review server did not accept connections");
        stream.write_all(request.as_bytes()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn lan_review_serves_video_and_synchronizes_comments() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let token = format!("editweavereviewtoken{nonce}");
        let path = std::env::temp_dir().join(format!("editweave-lan-review-{nonce}.mp4"));
        fs::write(&path, vec![0x5a; 2_048]).unwrap();
        let initial = serde_json::json!({
            "id": "first", "time": 1.25, "label": "첫 의견", "kind": "comment",
            "author": "편집자", "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
        });

        let session = start(token.clone(), "테스트 프로젝트".into(), "sequence-1".into(), path.to_string_lossy().into_owned(), vec![initial]).unwrap();
        let port = session.get("port").and_then(|value| value.as_u64()).unwrap() as u16;

        let page = request(port, &format!("GET /review/{token} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
        assert!(page.starts_with("HTTP/1.1 200 OK"));
        assert!(page.contains("EDITWEAVE REVIEW"));

        let api = request(port, &format!("GET /api/review/{token} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
        assert!(api.starts_with("HTTP/1.1 200 OK"));
        assert!(api.contains("테스트 프로젝트"));
        assert!(api.contains("첫 의견"));

        let media = request(port, &format!("GET /media/{token} HTTP/1.1\r\nHost: localhost\r\nRange: bytes=10-19\r\nConnection: close\r\n\r\n"));
        assert!(media.starts_with("HTTP/1.1 206 Partial Content"));
        assert!(media.contains("Content-Range: bytes 10-19/2048"));
        assert!(media.contains("Content-Length: 10"));

        let incoming = serde_json::json!({ "comments": [{
            "id": "second", "time": 2.5, "label": "검토자 의견", "kind": "comment",
            "author": "검토자", "createdAt": "2026-01-02T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z"
        }] }).to_string();
        let post = request(port, &format!("POST /api/review/{token} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{incoming}", incoming.len()));
        assert!(post.starts_with("HTTP/1.1 200 OK"));
        assert!(post.contains("검토자 의견"));

        let synchronized = sync(&token, Vec::new(), Vec::new()).unwrap();
        assert_eq!(synchronized.len(), 2);
        delete_comment(&token, "first").unwrap();
        assert_eq!(sync(&token, Vec::new(), Vec::new()).unwrap().len(), 1);
        stop(&token).unwrap();
        assert!(sync(&token, Vec::new(), Vec::new()).is_err());
        fs::remove_file(path).unwrap();
    }
}
