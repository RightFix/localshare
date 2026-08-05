use serde_json::Value;

#[derive(Clone, Debug)]
pub struct EventMsg {
    pub event: String,
    pub data: Value,
}

// Event types published via the bus, consumed by extension and browser sockets.
pub const EVENT_CLIENT: &str = "client";
pub const EVENT_FILE: &str = "file";

// Action strings within client events.
pub const ACTION_CLIENT_CONNECTED: &str = "client_connected";
pub const ACTION_CLIENT_APPROVED: &str = "client_approved";
pub const ACTION_CLIENT_REJECTED: &str = "client_rejected";
pub const ACTION_CLIENT_DISCONNECTED: &str = "client_disconnected";
pub const ACTION_SHARING_STOPPED: &str = "sharing_stopped";

// Action strings within file events.
pub const ACTION_UPLOAD_COMPLETED: &str = "upload_completed";
pub const ACTION_DOWNLOAD_COMPLETED: &str = "download_completed";

// WebSocket action strings sent to browser clients.
pub const WS_ACTION_PENDING: &str = "pending";
pub const WS_ACTION_APPROVED: &str = "approved";
pub const WS_ACTION_REJECTED: &str = "rejected";
