use crate::config::{new_uuid, now_iso};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Client {
    #[serde(default = "new_uuid")]
    pub id: String,
    #[serde(default)]
    pub device: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default = "now_iso")]
    pub connected_at: String,
}

impl Client {
    fn new(device: &str, ip: &str, user_agent: &str) -> Self {
        Client {
            id: new_uuid(),
            device: device.into(),
            ip: ip.into(),
            user_agent: user_agent.into(),
            connected_at: now_iso(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ClientsData {
    #[serde(default)]
    pub pending: Vec<Client>,
    #[serde(default)]
    pub connected: Vec<Client>,
}

impl ClientsData {
    pub fn add_pending(&mut self, device: &str, ip: &str, user_agent: &str) -> Client {
        let client = Client::new(device, ip, user_agent);
        self.pending.push(client.clone());
        client
    }

    pub fn get_pending(&self, client_id: &str) -> Option<&Client> {
        self.pending.iter().find(|c| c.id == client_id)
    }

    pub fn remove_pending(&mut self, client_id: &str) -> bool {
        if let Some(pos) = self.pending.iter().position(|c| c.id == client_id) {
            self.pending.remove(pos);
            true
        } else {
            false
        }
    }

    pub fn approve(&mut self, client_id: &str) -> Option<Client> {
        let client = self.get_pending(client_id).cloned();
        if let Some(client) = client {
            self.remove_pending(client_id);
            self.connected.push(client.clone());
            Some(client)
        } else {
            None
        }
    }

    pub fn get_connected(&self, client_id: &str) -> Option<&Client> {
        self.connected.iter().find(|c| c.id == client_id)
    }

    pub fn remove_connected(&mut self, client_id: &str) -> bool {
        if let Some(pos) = self.connected.iter().position(|c| c.id == client_id) {
            self.connected.remove(pos);
            true
        } else {
            false
        }
    }

    pub fn clear(&mut self) {
        self.pending.clear();
        self.connected.clear();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Session {
    #[serde(default = "new_uuid")]
    pub id: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub device: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default = "now_iso")]
    pub approved_at: String,
    #[serde(default = "now_iso")]
    pub last_active: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionsData {
    #[serde(default)]
    pub sessions: Vec<Session>,
}

impl SessionsData {
    pub fn add(&mut self, device: &str, ip: &str, client_id: &str) -> Session {
        let session = Session {
            id: new_uuid(),
            client_id: client_id.into(),
            device: device.into(),
            ip: ip.into(),
            approved_at: now_iso(),
            last_active: now_iso(),
        };
        self.sessions.push(session.clone());
        session
    }

    pub fn get(&self, session_id: &str) -> Option<&Session> {
        self.sessions.iter().find(|s| s.id == session_id)
    }

    pub fn remove(&mut self, session_id: &str) -> bool {
        if let Some(pos) = self.sessions.iter().position(|s| s.id == session_id) {
            self.sessions.remove(pos);
            true
        } else {
            false
        }
    }

    pub fn clear(&mut self) {
        self.sessions.clear();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UploadRecord {
    pub filename: String,
    pub size: u64,
    #[serde(default)]
    pub from_device: String,
    #[serde(default = "now_iso")]
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DownloadRecord {
    pub filename: String,
    pub size: u64,
    #[serde(default)]
    pub to_device: String,
    #[serde(default = "now_iso")]
    pub at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ActivityData {
    #[serde(default)]
    pub uploads: Vec<UploadRecord>,
    #[serde(default)]
    pub downloads: Vec<DownloadRecord>,
}

impl ActivityData {
    pub fn add_upload(&mut self, filename: &str, size: u64, from_device: &str) {
        self.uploads.insert(
            0,
            UploadRecord {
                filename: filename.into(),
                size,
                from_device: from_device.into(),
                at: now_iso(),
            },
        );
    }

    pub fn add_download(&mut self, filename: &str, size: u64, to_device: &str) {
        self.downloads.insert(
            0,
            DownloadRecord {
                filename: filename.into(),
                size,
                to_device: to_device.into(),
                at: now_iso(),
            },
        );
    }

    pub fn clear(&mut self) {
        self.uploads.clear();
        self.downloads.clear();
    }
}
