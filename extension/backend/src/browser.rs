use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Component, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use rust_embed::RustEmbed;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

use crate::auth::{get_session_id, validate_session, verify_csrf};
use crate::config::{lexical_resolve, now_iso};
use crate::events::{
    ACTION_CLIENT_APPROVED, ACTION_CLIENT_REJECTED, ACTION_TEXT_RECEIVED, EVENT_CLIENT,
    EVENT_TEXT, WS_ACTION_APPROVED, WS_ACTION_PENDING, WS_ACTION_REJECTED,
};
use crate::AppState;

#[derive(RustEmbed)]
#[folder = "assets/"]
pub struct Assets;

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/style.css", get(style_css))
        .route("/app.js", get(app_js))
        .route("/api/status", get(api_status))
        .route("/api/upload", post(api_upload))
        .route("/api/send-text", post(api_send_text))
        .layer(DefaultBodyLimit::disable())
        .route("/api/files", get(api_list_files))
        .route("/api/files/{*filepath}", get(api_download_file))
        .route("/ws/client", get(ws_client))
        .with_state(state)
}

fn serve_asset(path: &str, content_type: &str) -> Response {
    match Assets::get(path) {
        Some(f) => {
            let mut resp = Response::new(Body::from(f.data.into_owned()));
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                content_type.parse().unwrap(),
            );
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                "no-store, max-age=0".parse().unwrap(),
            );
            resp
        }
        None => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

fn unauthorized_response(headers: &HeaderMap) -> Response {
    let wants_html = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/html"))
        .unwrap_or(false);

    if wants_html {
        let body = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LocalShare - Session expired</title>
<style>
body { font-family: system-ui, sans-serif; background: #1c1c1c; color: #eee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.box { max-width: 420px; padding: 32px; text-align: center; }
h1 { font-size: 20px; margin-bottom: 12px; }
p { color: #aaa; margin-bottom: 24px; }
a { display: inline-block; padding: 10px 20px; border-radius: 8px; background: #3584e4; color: #fff; text-decoration: none; }
</style>
</head>
<body>
<div class="box">
<h1>Session expired</h1>
<p>Your connection needs to be approved again. Returning to the start&hellip;</p>
<a href="/">Continue</a>
</div>
<script>
document.cookie = 'session_id=; Max-Age=0; path=/';
setTimeout(function () { window.location.replace('/'); }, 1200);
</script>
</body>
</html>"#;
        let mut resp = (StatusCode::UNAUTHORIZED, Html(body)).into_response();
        resp.headers_mut().insert(
            header::SET_COOKIE,
            "session_id=; Max-Age=0; Path=/; SameSite=Lax"
                .parse()
                .unwrap(),
        );
        resp.headers_mut()
            .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
        resp
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized" })),
        )
            .into_response()
    }
}

async fn root() -> Response {
    serve_asset("index.html", "text/html; charset=utf-8")
}

async fn style_css() -> Response {
    serve_asset("style.css", "text/css; charset=utf-8")
}

async fn app_js() -> Response {
    serve_asset("app.js", "application/javascript; charset=utf-8")
}

async fn api_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Json<Value> {
    if let Some(sid) = get_session_id(&headers) {
        let sessions = state
            .storage
            .update_sessions(|s| {
                if let Some(session) = s.sessions.iter_mut().find(|x| x.id == sid) {
                    session.last_active = now_iso();
                }
            })
            .await;
        if sessions.sessions.iter().any(|x| x.id == sid) {
            return Json(json!({ "status": "approved", "session_id": sid }));
        }
    }
    Json(json!({ "status": "pending" }))
}

fn sanitize_filename(filename: &str) -> String {
    let cleaned: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || "._- ".contains(*c))
        .collect();
    cleaned.chars().take(200).collect()
}

async fn api_upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let sid = match validate_session(&state.storage, &headers).await {
        Some(s) => s,
        None => return unauthorized_response(&headers),
    };
    if !verify_csrf(&headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "CSRF check failed" })),
        )
            .into_response();
    }

    let config = state.storage.get_config().await;
    let upload_dir = config.upload_dir;
    let mut uploaded: Vec<String> = Vec::new();
    let mut had_files = false;

    loop {
        let mut field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid form data" })),
                )
                    .into_response()
            }
        };
        if field.name() != Some("file") {
            continue;
        }
        had_files = true;

        let filename = field.file_name().unwrap_or("unknown").to_string();
        let safe_name = sanitize_filename(&filename);

        let mut final_name = safe_name.clone();
        let mut target = upload_dir.join(&safe_name);
        let mut counter = 1;
        while target.exists() {
            let (base, ext) = match safe_name.rfind('.') {
                Some(idx) if idx > 0 => {
                    (safe_name[..idx].to_string(), safe_name[idx..].to_string())
                }
                _ => (safe_name.clone(), String::new()),
            };
            final_name = format!("{base}_{counter}{ext}");
            target = upload_dir.join(&final_name);
            counter += 1;
        }

        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut file = match tokio::fs::File::create(&target).await {
            Ok(f) => f,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("Write failed: {e}") })),
                )
                    .into_response()
            }
        };
        let mut size: u64 = 0;
        let mut write_failed = false;
        while let Some(chunk) = field.chunk().await.transpose() {
            match chunk {
                Ok(bytes) => {
                    size += bytes.len() as u64;
                    if file.write_all(&bytes).await.is_err() {
                        write_failed = true;
                        break;
                    }
                }
                Err(_) => {
                    write_failed = true;
                    break;
                }
            }
        }
        let _ = file.flush().await;
        drop(file);

        if write_failed {
            let _ = tokio::fs::remove_file(&target).await;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Upload failed: write error or connection interrupted" })),
            )
                .into_response();
        }

        let sessions = state.storage.get_sessions().await;
        let device = sessions
            .sessions
            .iter()
            .find(|s| s.id == sid)
            .map(|s| s.device.clone())
            .unwrap_or_else(|| "Unknown".into());
        state
            .manager
            .notify_upload(&final_name, size, &device, None)
            .await;
        uploaded.push(final_name);
    }

    if !had_files {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No files provided" })),
        )
            .into_response();
    }
    Json(json!({ "message": format!("Uploaded: {}", uploaded.join(", ")) })).into_response()
}

async fn api_send_text(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let sid = match validate_session(&state.storage, &headers).await {
        Some(s) => s,
        None => return unauthorized_response(&headers),
    };
    if !verify_csrf(&headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "CSRF check failed" })),
        )
            .into_response()
    }

    let text = body.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if text.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No text provided" })),
        )
            .into_response();
    }

    let config = state.storage.get_config().await;
    let filename = format!("clip_{}.txt", crate::config::new_uuid());
    let target = config.upload_dir.join(&filename);
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut file = match tokio::fs::File::create(&target).await {
        Ok(f) => f,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Write failed: {e}") })),
            )
                .into_response()
        }
    };
    let mut write_failed = false;
    if let Err(e) = file.write_all(text.as_bytes()).await {
        eprintln!("Text upload write error: {e}");
        write_failed = true;
    }
    if let Err(e) = file.flush().await {
        eprintln!("Text upload flush error: {e}");
        write_failed = true;
    }
    drop(file);
    if write_failed {
        let _ = tokio::fs::remove_file(&target).await;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Upload failed" })),
        )
            .into_response();
    }

    let sessions = state.storage.get_sessions().await;
    let device = sessions
        .sessions
        .iter()
        .find(|s| s.id == sid)
        .map(|s| s.device.clone())
        .unwrap_or_else(|| "Unknown".into());
    let size = text.len() as u64;
    state
        .manager
        .notify_upload(&filename, size, &device, Some(text))
        .await;
    Json(json!({ "status": "success", "filename": filename })).into_response()
}

async fn api_list_files(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if validate_session(&state.storage, &headers).await.is_none() {
        return unauthorized_response(&headers);
    }

    let path = params.get("path").cloned().unwrap_or_default();
    let send_files = state.manager.get_send_files().await;

    if !send_files.is_empty() {
        if !path.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid path" })),
            )
                .into_response();
        }
        let mut files = Vec::new();
        for (name, real) in &send_files {
            let meta = match std::fs::metadata(real) {
                Ok(m) => m,
                Err(_) => continue,
            };
            files.push(json!({
                "name": name,
                "path": name,
                "size": meta.len(),
                "modified": mtime(&meta),
                "isDirectory": false,
            }));
        }
        return Json(Value::Array(files)).into_response();
    }

    let config = state.storage.get_config().await;
    let shared_dir = config.shared_dir;
    let shared_resolved = lexical_resolve(&shared_dir);
    let target = if path.is_empty() {
        shared_dir.clone()
    } else {
        shared_dir.join(&path)
    };
    let resolved = lexical_resolve(&target);

    if !resolved.starts_with(&shared_resolved) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid path" })),
        )
            .into_response();
    }
    if !resolved.exists() || !resolved.is_dir() {
        return Json(Value::Array(vec![])).into_response();
    }

    let mut entries: Vec<_> = match std::fs::read_dir(&resolved) {
        Ok(e) => e.filter_map(|e| e.ok()).collect(),
        Err(_) => vec![],
    };
    entries.sort_by_key(|e| e.file_name());

    let mut files = Vec::new();
    for entry in entries {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if path.is_empty() {
            name.clone()
        } else {
            format!("{path}/{name}")
        };
        if meta.is_file() {
            files.push(json!({
                "name": name,
                "path": rel,
                "size": meta.len(),
                "modified": mtime(&meta),
                "isDirectory": false,
            }));
        } else if meta.is_dir() {
            files.push(json!({
                "name": name,
                "path": rel,
                "size": 0,
                "modified": mtime(&meta),
                "isDirectory": true,
            }));
        }
    }
    Json(Value::Array(files)).into_response()
}

async fn api_download_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(filepath): Path<String>,
) -> Response {
    let sid = match validate_session(&state.storage, &headers).await {
        Some(s) => s,
        None => return unauthorized_response(&headers),
    };

    if !filepath.contains('/') {
        let send_files = state.manager.get_send_files().await;
        if let Some(real) = send_files.get(&filepath) {
            if real.is_file() {
                let sessions = state.storage.get_sessions().await;
                let device = sessions
                    .sessions
                    .iter()
                    .find(|s| s.id == sid)
                    .map(|s| s.device.clone())
                    .unwrap_or_else(|| "Unknown".into());
                let name = real
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let size = std::fs::metadata(real).map(|m| m.len()).unwrap_or(0);
                state
                    .manager
                    .notify_download(&name, size, &device, None)
                    .await;
                return file_response(real.clone(), &name);
            }
        }
    }

    let config = state.storage.get_config().await;
    let shared_dir = config.shared_dir;
    let safe_path = PathBuf::from(&filepath);
    if safe_path.is_absolute()
        || safe_path.components().any(|c| matches!(c, Component::ParentDir))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid path" })),
        )
            .into_response();
    }

    let file_path = shared_dir.join(&safe_path);
    let resolved = lexical_resolve(&file_path);
    if !resolved.starts_with(&lexical_resolve(&shared_dir)) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found" })),
        )
            .into_response();
    }
    if !file_path.exists() || !file_path.is_file() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found" })),
        )
            .into_response();
    }

    let sessions = state.storage.get_sessions().await;
    let device = sessions
        .sessions
        .iter()
        .find(|s| s.id == sid)
        .map(|s| s.device.clone())
        .unwrap_or_else(|| "Unknown".into());
    let name = file_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
    state
        .manager
        .notify_download(&name, size, &device, None)
        .await;
    file_response(file_path, &name)
}

fn mtime(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn file_response(path: PathBuf, name: &str) -> Response {
    match std::fs::File::open(&path) {
        Ok(f) => {
            let stream = ReaderStream::new(tokio::fs::File::from_std(f));
            let mut resp = Response::new(Body::from_stream(stream));
            let safe_name = name.replace('"', "_");
            resp.headers_mut().insert(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{safe_name}\"")
                    .parse()
                    .unwrap(),
            );
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                "application/octet-stream".parse().unwrap(),
            );
            resp
        }
        Err(_) => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

async fn ws_client(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Response {
    ws.on_upgrade(move |socket| handle_browser_ws(socket, state, peer, headers))
}

struct BrowserSocketGuard(Arc<AppState>);

impl Drop for BrowserSocketGuard {
    fn drop(&mut self) {
        self.0.manager.unregister_browser();
    }
}

async fn deliver_pending_texts(
    state: &Arc<AppState>,
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) {
    for text in state.manager.take_pending_texts().await {
        let msg = json!({ "action": ACTION_TEXT_RECEIVED, "text": text });
        if sink.send(Message::Text(msg.to_string().into())).await.is_err() {
            return;
        }
    }
}

async fn handle_browser_ws(
    socket: WebSocket,
    state: Arc<AppState>,
    peer: SocketAddr,
    headers: HeaderMap,
) {
    let (mut sink, mut stream) = socket.split();

    // If this browser already holds a valid approved session, do not ask for
    // approval again. Reconnects (page reload, phone waking up, backend
    // restart) simply resume the existing session.
    if let Some(sid) = validate_session(&state.storage, &headers).await {
        let msg = json!({ "action": WS_ACTION_APPROVED, "token": sid });
        if sink.send(Message::Text(msg.to_string().into())).await.is_err() {
            return;
        }
        state.manager.register_browser();
        let _guard = BrowserSocketGuard(state.clone());
        deliver_pending_texts(&state, &mut sink).await;
        let mut rx = state.manager.bus.subscribe();
        loop {
            tokio::select! {
                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Ping(p))) => {
                            if sink.send(Message::Pong(p)).await.is_err() {
                                return;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                        _ => {}
                    }
                }
                evt = rx.recv() => {
                    if let Ok(e) = evt {
                        if e.event == EVENT_TEXT
                            && sink.send(Message::Text(e.data.to_string().into())).await.is_err()
                        {
                            return;
                        }
                    }
                }
            }
        }
    }

    let first: Option<String> = loop {
        match stream.next().await {
            Some(Ok(Message::Text(t))) => break Some(t.to_string()),
            Some(Ok(Message::Ping(p))) => {
                if sink.send(Message::Pong(p)).await.is_err() {
                    return;
                }
            }
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
            _ => {}
        }
    };

    let data: Value =
        serde_json::from_str(first.as_deref().unwrap_or("{}")).unwrap_or(json!({}));
    let device = data
        .get("device")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Device")
        .to_string();
    let ip = data
        .get("ip")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| peer.ip().to_string());
    let user_agent = data
        .get("user_agent")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let client_id = state
        .manager
        .add_pending_client(&device, &ip, &user_agent)
        .await;

    let pending = json!({
        "action": WS_ACTION_PENDING,
        "message": "Waiting for approval...",
        "client_id": client_id,
    });
    if sink.send(Message::Text(pending.to_string().into())).await.is_err() {
        let _ = state.manager.remove_pending_client(&client_id).await;
        return;
    }

    let mut rx = state.manager.bus.subscribe();
    let mut session_id: Option<String> = None;
    let mut browser_guard: Option<BrowserSocketGuard> = None;

    loop {
        tokio::select! {
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Ping(p))) => {
                        if sink.send(Message::Pong(p)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
            evt = rx.recv() => {
                match evt {
                    Ok(e) => {
                        let d = &e.data;
                        if e.event == EVENT_TEXT {
                            if sink.send(Message::Text(d.to_string().into())).await.is_err() {
                                break;
                            }
                            continue;
                        }
                        if d.get("client_id").and_then(|v| v.as_str()) != Some(client_id.as_str()) {
                            continue;
                        }
                        if e.event == EVENT_CLIENT {
                            let action = d.get("action").and_then(|v| v.as_str());
                            if action == Some(ACTION_CLIENT_APPROVED) {
                                session_id = d.get("session_id").and_then(|v| v.as_str()).map(String::from);
                                let msg = json!({
                                    "action": WS_ACTION_APPROVED,
                                    "token": session_id.as_deref().unwrap_or(""),
                                });
                                if sink.send(Message::Text(msg.to_string().into())).await.is_err() {
                                    break;
                                }
                                state.manager.register_browser();
                                browser_guard = Some(BrowserSocketGuard(state.clone()));
                                deliver_pending_texts(&state, &mut sink).await;
                            } else if action == Some(ACTION_CLIENT_REJECTED) {
                                if sink.send(Message::Text(json!({ "action": WS_ACTION_REJECTED }).to_string().into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }

    drop(browser_guard);
    let _ = sink.close().await;

    // Do not delete the approved session when the socket closes: phones
    // background tabs, sleep, or briefly lose Wi-Fi, and deleting the
    // session here made later downloads fail with 401. Sessions remain
    // valid until sharing is stopped (or explicitly disconnected).
    let _ = session_id;
    state
        .storage
        .update_clients(|c| {
            c.remove_connected(&client_id);
        })
        .await;
    let _ = state.manager.remove_pending_client(&client_id).await;
}
