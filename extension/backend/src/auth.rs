use axum::http::{header, HeaderMap};

use crate::config::now_iso;
use crate::storage::StorageManager;

pub fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie.split(';') {
        let part = part.trim();
        if let Some((k, v)) = part.split_once('=') {
            if k.trim() == name {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

pub fn get_session_id(headers: &HeaderMap) -> Option<String> {
    cookie_value(headers, "session_id").or_else(|| {
        headers
            .get("X-Session-Token")
            .and_then(|v| v.to_str().ok())
            .map(String::from)
    })
}

pub async fn validate_session(storage: &StorageManager, headers: &HeaderMap) -> Option<String> {
    let sid = get_session_id(headers)?;
    let sessions = storage
        .update_sessions(|s| {
            if let Some(session) = s.sessions.iter_mut().find(|x| x.id == sid) {
                session.last_active = now_iso();
            }
        })
        .await;
    if sessions.sessions.iter().any(|s| s.id == sid) {
        Some(sid)
    } else {
        None
    }
}

pub fn verify_csrf(headers: &HeaderMap) -> bool {
    let cookie = cookie_value(headers, "session_id");
    let header = headers
        .get("X-Session-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    match (cookie, header) {
        (Some(c), Some(h)) => c == h,
        _ => false,
    }
}
