use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::events::{
    ACTION_CLIENT_APPROVED, ACTION_CLIENT_CONNECTED, ACTION_CLIENT_DISCONNECTED,
    ACTION_CLIENT_REJECTED, ACTION_DOWNLOAD_COMPLETED, ACTION_SHARING_STOPPED,
    ACTION_UPLOAD_COMPLETED, EVENT_CLIENT, EVENT_FILE, EventMsg,
};
use crate::models::Session;
use crate::storage::{ArcStorage, StorageManager};

pub struct ServerManager {
    pub storage: ArcStorage,
    pub bus: broadcast::Sender<EventMsg>,
    lan: Mutex<Option<(tokio::task::JoinHandle<()>, u16)>>,
    send_files: RwLock<HashMap<String, PathBuf>>,
}

impl ServerManager {
    pub fn new(storage: Arc<StorageManager>, bus: broadcast::Sender<EventMsg>) -> Self {
        ServerManager {
            storage,
            bus,
            lan: Mutex::new(None),
            send_files: RwLock::new(HashMap::new()),
        }
    }

    pub fn publish(&self, event: &str, data: Value) {
        let _ = self.bus.send(EventMsg {
            event: event.to_string(),
            data,
        });
    }

    pub async fn set_send_files(&self, paths: Vec<PathBuf>) -> HashMap<String, PathBuf> {
        let map = Self::build_send_map(paths);
        *self.send_files.write().await = map.clone();
        map
    }

    pub async fn clear_send_files(&self) {
        self.send_files.write().await.clear();
    }

    pub async fn get_send_files(&self) -> HashMap<String, PathBuf> {
        self.send_files.read().await.clone()
    }

    fn build_send_map(paths: Vec<PathBuf>) -> HashMap<String, PathBuf> {
        let mut result: HashMap<String, PathBuf> = HashMap::new();
        for raw in paths {
            if !raw.is_absolute() {
                continue;
            }
            let resolved = std::fs::canonicalize(&raw).unwrap_or_else(|_| raw.clone());
            if !resolved.is_file() {
                continue;
            }
            let base = raw
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let stem = raw
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = raw
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let mut name = base.clone();
            let mut counter = 1;
            while name.is_empty() || result.contains_key(&name) {
                name = if ext.is_empty() {
                    format!("{stem}_{counter}")
                } else {
                    format!("{stem}_{counter}{ext}")
                };
                counter += 1;
            }
            result.insert(name, resolved);
        }
        result
    }

    async fn stop_lan_handle(lan: &mut Option<(tokio::task::JoinHandle<()>, u16)>) {
        if let Some((handle, _)) = lan.take() {
            handle.abort();
            let _ = handle.await;
        }
    }

    pub async fn start(
        &self,
        port: u16,
        internal_port: u16,
        upload_dir: PathBuf,
        shared_dir: PathBuf,
        state: Arc<crate::AppState>,
    ) -> bool {
        self.clear_send_files().await;

        let mut config = self.storage.get_config().await;
        config.port = port;
        config.internal_port = internal_port;
        config.upload_dir = upload_dir.clone();
        config.shared_dir = shared_dir.clone();
        config.sharing_enabled = true;
        self.storage.save_config(&config).await;

        let _ = std::fs::create_dir_all(&upload_dir);
        let _ = std::fs::create_dir_all(&shared_dir);

        let mut lan = self.lan.lock().await;
        if let Some((_, p)) = lan.as_ref() {
            if *p != port {
                Self::stop_lan_handle(&mut lan).await;
            }
        }

        if lan.is_none() {
            let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("LAN server failed to bind on 0.0.0.0:{port}: {e}");
                    drop(lan);
                    self.storage.disable_sharing().await;
                    return false;
                }
            };
            let router = crate::browser::build_router(state);
            let handle = tokio::spawn(async move {
                let _ = axum::serve(
                    listener,
                    router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
                )
                .await;
            });
            *lan = Some((handle, port));
        }
        true
    }

    pub async fn stop(&self) {
        self.publish(
            EVENT_CLIENT,
            json!({ "action": ACTION_SHARING_STOPPED }),
        );
        let mut lan = self.lan.lock().await;
        Self::stop_lan_handle(&mut lan).await;
        drop(lan);
        self.storage.disable_sharing().await;
        self.clear_send_files().await;
    }

    pub async fn shutdown(&self) {
        let mut lan = self.lan.lock().await;
        Self::stop_lan_handle(&mut lan).await;
        drop(lan);
        self.storage.disable_sharing().await;
    }

    pub async fn is_running(&self) -> bool {
        self.lan.lock().await.is_some()
    }

    pub async fn approve_client(&self, client_id: &str) -> Option<Session> {
        let clients = self
            .storage
            .update_clients(|c| {
                c.approve(client_id);
            })
            .await;
        let client = match clients.get_connected(client_id) {
            Some(c) => c.clone(),
            None => return None,
        };
        let sessions = self
            .storage
            .update_sessions(|s| {
                s.add(&client.device, &client.ip, &client.id);
            })
            .await;
        let session = sessions
            .sessions
            .iter()
            .find(|s| s.client_id == client.id)
            .cloned()?;

        self.publish(
            EVENT_CLIENT,
            json!({
                "action": ACTION_CLIENT_APPROVED,
                "client_id": client.id,
                "session_id": session.id,
                "device": client.device,
            }),
        );
        Some(session)
    }

    pub async fn reject_client(&self, client_id: &str) -> bool {
        let mut found = false;
        self.storage
            .update_clients(|c| {
                if c.get_pending(client_id).is_some() {
                    c.remove_pending(client_id);
                    found = true;
                }
            })
            .await;
        if found {
            self.publish(
                EVENT_CLIENT,
                json!({ "action": ACTION_CLIENT_REJECTED, "client_id": client_id }),
            );
        }
        found
    }

    pub async fn disconnect_client(&self, session_id: &str) -> bool {
        let mut removed: Option<Session> = None;
        self.storage
            .update_sessions(|s| {
                if let Some(session) = s.sessions.iter().find(|x| x.id == session_id).cloned() {
                    s.remove(session_id);
                    removed = Some(session);
                }
            })
            .await;
        let Some(session) = removed else {
            return false;
        };
        let client_id = session.client_id.clone();
        self.storage
            .update_clients(|c| {
                c.remove_connected(&client_id);
            })
            .await;
        self.publish(
            EVENT_CLIENT,
            json!({ "action": ACTION_CLIENT_DISCONNECTED, "session_id": session_id }),
        );
        true
    }

    pub async fn add_pending_client(&self, device: &str, ip: &str, user_agent: &str) -> String {
        let mut client_id = String::new();
        self.storage
            .update_clients(|c| {
                let client = c.add_pending(device, ip, user_agent);
                client_id = client.id.clone();
            })
            .await;
        self.publish(
            EVENT_CLIENT,
            json!({
                "action": ACTION_CLIENT_CONNECTED,
                "client_id": client_id,
                "device": device,
                "ip": ip,
            }),
        );
        client_id
    }

    pub async fn remove_pending_client(&self, client_id: &str) -> bool {
        self.storage
            .update_clients(|c| {
                c.remove_pending(client_id);
            })
            .await;
        true
    }

    pub async fn notify_upload(&self, filename: &str, size: u64, from_device: &str) {
        self.storage
            .update_activity(|a| a.add_upload(filename, size, from_device))
            .await;
        self.publish(
            EVENT_FILE,
            json!({
                "action": ACTION_UPLOAD_COMPLETED,
                "filename": filename,
                "size": size,
                "from_device": from_device,
            }),
        );
    }

    pub async fn notify_download(&self, filename: &str, size: u64, to_device: &str) {
        self.storage
            .update_activity(|a| a.add_download(filename, size, to_device))
            .await;
        self.publish(
            EVENT_FILE,
            json!({
                "action": ACTION_DOWNLOAD_COMPLETED,
                "filename": filename,
                "size": size,
                "to_device": to_device,
            }),
        );
    }
}
