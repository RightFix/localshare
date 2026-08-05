use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};

use crate::config::Config;
use crate::AppState;

fn error_response(code: StatusCode, message: &str, detail: Option<Value>) -> Response {
    let mut body = json!({ "status": "error", "message": message });
    if let Some(d) = detail {
        body["detail"] = d;
    }
    (code, Json(body)).into_response()
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/internal/status", get(status))
        .route("/internal/config", get(get_config).put(put_config))
        .route("/internal/start", post(start))
        .route("/internal/stop", post(stop))
        .route("/internal/approve/{client_id}", post(approve))
        .route("/internal/reject/{client_id}", post(reject))
        .route("/internal/pending", get(pending))
        .route("/internal/clients", get(clients))
        .route("/internal/ips", get(ips))
        .route("/internal/send-files", get(get_send_files).put(put_send_files))
        .route("/internal/ws/events", get(ws_events))
        .with_state(state)
}

async fn status(State(state): State<Arc<AppState>>) -> Json<Value> {
    let s = state.storage.get_status().await;
    Json(serde_json::to_value(&s).unwrap_or(Value::Null))
}

async fn get_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    let c = state.storage.get_config().await;
    Json(serde_json::to_value(&c).unwrap_or(Value::Null))
}

async fn put_config(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Response {
    let current = state.storage.get_config().await;
    let mut merged = serde_json::to_value(&current).unwrap_or(json!({}));
    if let (Some(target), Some(incoming)) = (merged.as_object_mut(), body.as_object()) {
        for (k, v) in incoming {
            target.insert(k.clone(), v.clone());
        }
    }
    let config: Config = match serde_json::from_value::<Config>(merged) {
        Ok(mut c) => {
            c.normalize();
            c
        }
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "Invalid config", None),
    };
    if let Err(errs) = config.validate() {
        let detail = errs.into_iter().map(Value::String).collect();
        return error_response(
            StatusCode::BAD_REQUEST,
            "Invalid config",
            Some(Value::Array(detail)),
        );
    }
    state.storage.save_config(&config).await;
    Json(json!({ "status": "success" })).into_response()
}

async fn start(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Response {
    let config: Config = match serde_json::from_value::<Config>(body) {
        Ok(mut c) => {
            c.normalize();
            c
        }
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "Invalid config", None),
    };
    if let Err(errs) = config.validate() {
        let detail = errs.into_iter().map(Value::String).collect();
        return error_response(
            StatusCode::BAD_REQUEST,
            "Invalid config",
            Some(Value::Array(detail)),
        );
    }
    let ok = state
        .manager
        .start(
            config.port,
            config.internal_port,
            config.upload_dir.clone(),
            config.shared_dir.clone(),
            state.clone(),
        )
        .await;
    Json(json!({ "status": if ok { "success" } else { "error" } })).into_response()
}

async fn stop(State(state): State<Arc<AppState>>) -> Json<Value> {
    state.manager.stop().await;
    Json(json!({ "status": "success" }))
}

async fn approve(State(state): State<Arc<AppState>>, Path(client_id): Path<String>) -> Response {
    match state.manager.approve_client(&client_id).await {
        Some(session) => Json(json!({ "status": "success", "session_id": session.id }))
            .into_response(),
        None => error_response(StatusCode::NOT_FOUND, "Client not found", None),
    }
}

async fn reject(State(state): State<Arc<AppState>>, Path(client_id): Path<String>) -> Json<Value> {
    let ok = state.manager.reject_client(&client_id).await;
    Json(json!({ "status": if ok { "success" } else { "error" } }))
}

async fn pending(State(state): State<Arc<AppState>>) -> Json<Value> {
    let clients = state.storage.get_clients().await;
    let arr = clients
        .pending
        .iter()
        .map(|c| serde_json::to_value(c).unwrap_or(Value::Null))
        .collect::<Vec<_>>();
    Json(json!({ "pending": arr }))
}

async fn clients(State(state): State<Arc<AppState>>) -> Json<Value> {
    let clients = state.storage.get_clients().await;
    let sessions = state.storage.get_sessions().await;
    let mut connected = Vec::new();
    for c in &clients.connected {
        if let Some(s) = sessions.sessions.iter().find(|s| s.client_id == c.id) {
            let mut v = serde_json::to_value(c).unwrap_or(Value::Null);
            v["session_id"] = json!(s.id);
            connected.push(v);
        }
    }
    Json(json!({ "connected": connected }))
}

async fn ips() -> Json<Value> {
    Json(json!({ "ips": crate::network::get_all_local_ips() }))
}

async fn get_send_files(State(state): State<Arc<AppState>>) -> Json<Value> {
    let map = state.manager.get_send_files().await;
    let files = map
        .iter()
        .map(|(name, path)| {
            json!({ "name": name, "path": path.to_string_lossy().to_string() })
        })
        .collect::<Vec<_>>();
    Json(json!({ "files": files }))
}

async fn put_send_files(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Json<Value> {
    let paths: Vec<String> = body
        .get("files")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let paths = paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let map = state.manager.set_send_files(paths).await;
    let files = map
        .iter()
        .map(|(name, path)| {
            json!({ "name": name, "path": path.to_string_lossy().to_string() })
        })
        .collect::<Vec<_>>();
    Json(json!({ "status": "success", "files": files }))
}

async fn ws_events(State(state): State<Arc<AppState>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_extension_ws(socket, state))
}

async fn handle_extension_ws(socket: WebSocket, state: Arc<AppState>) {
    let (mut sink, mut stream) = socket.split();
    let mut rx = state.manager.bus.subscribe();
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
                        let payload = json!({ "event": e.event, "data": e.data });
                        if sink.send(Message::Text(payload.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }
    let _ = sink.close().await;
}
