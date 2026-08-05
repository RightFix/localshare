use std::path::PathBuf;
use std::sync::Arc;

use crate::config::{Config, ServerStatus};
use crate::json_store::JsonStore;
use crate::models::{ActivityData, ClientsData, SessionsData};

pub struct StorageManager {
    pub data_dir: PathBuf,
    config: JsonStore<Config>,
    sessions: JsonStore<SessionsData>,
    clients: JsonStore<ClientsData>,
    activity: JsonStore<ActivityData>,
}

impl StorageManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        StorageManager {
            config: JsonStore::new(data_dir.join("config.json")),
            sessions: JsonStore::new(data_dir.join("sessions.json")),
            clients: JsonStore::new(data_dir.join("clients.json")),
            activity: JsonStore::new(data_dir.join("activity.json")),
            data_dir,
        }
    }

    pub async fn get_config(&self) -> Config {
        let mut config = self.config.load().await;
        config.normalize();
        config
    }

    pub async fn save_config(&self, config: &Config) {
        self.config.save(config).await;
    }

    pub async fn get_sessions(&self) -> SessionsData {
        self.sessions.load().await
    }

    pub async fn get_clients(&self) -> ClientsData {
        self.clients.load().await
    }

    pub async fn get_activity(&self) -> ActivityData {
        self.activity.load().await
    }

    pub async fn update_clients(&self, f: impl FnOnce(&mut ClientsData)) -> ClientsData {
        self.clients.update(f).await
    }

    pub async fn update_sessions(&self, f: impl FnOnce(&mut SessionsData)) -> SessionsData {
        self.sessions.update(f).await
    }

    pub async fn update_activity(&self, f: impl FnOnce(&mut ActivityData)) -> ActivityData {
        self.activity.update(f).await
    }

    pub async fn get_status(&self) -> ServerStatus {
        let config = self.get_config().await;
        let clients = self.get_clients().await;
        let on = config.sharing_enabled;
        ServerStatus {
            running: on,
            port: if on { Some(config.port) } else { None },
            internal_port: if on { Some(config.internal_port) } else { None },
            upload_dir: if on { Some(config.upload_dir.clone()) } else { None },
            shared_dir: if on { Some(config.shared_dir.clone()) } else { None },
            sharing_enabled: on,
            connected_clients: clients.connected.len(),
            pending_clients: clients.pending.len(),
        }
    }

    pub async fn disable_sharing(&self) {
        let mut config = self.get_config().await;
        config.sharing_enabled = false;
        self.save_config(&config).await;
        self.update_sessions(|s| s.clear()).await;
        self.update_clients(|c| c.clear()).await;
    }
}

pub type ArcStorage = Arc<StorageManager>;
