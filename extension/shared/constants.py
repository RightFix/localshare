"""Shared constants for LocalShare.

Single source of truth for event types, API routes, and configuration
defaults shared between the backend and extension.
"""

# ── Event types ────────────────────────────────────────────────────
# Published via EventBus, consumed by extension and browser WebSockets.
EVENT_CLIENT = "client"
EVENT_FILE = "file"

# Action strings within client events
ACTION_CLIENT_CONNECTED = "client_connected"
ACTION_CLIENT_APPROVED = "client_approved"
ACTION_CLIENT_REJECTED = "client_rejected"
ACTION_CLIENT_DISCONNECTED = "client_disconnected"

ACTION_SHARING_STOPPED = "sharing_stopped"

# Action strings within file events
ACTION_UPLOAD_COMPLETED = "upload_completed"
ACTION_DOWNLOAD_COMPLETED = "download_completed"

# WebSocket action strings sent to browser clients
WS_ACTION_PENDING = "pending"
WS_ACTION_APPROVED = "approved"
WS_ACTION_REJECTED = "rejected"

# ── Internal API routes (127.0.0.1:8765) ──────────────────────────
INTERNAL_STATUS = "/internal/status"
INTERNAL_CONFIG = "/internal/config"
INTERNAL_START = "/internal/start"
INTERNAL_STOP = "/internal/stop"
INTERNAL_APPROVE = "/internal/approve/{client_id}"
INTERNAL_REJECT = "/internal/reject/{client_id}"
INTERNAL_PENDING = "/internal/pending"
INTERNAL_CLIENTS = "/internal/clients"
INTERNAL_IPS = "/internal/ips"


# ── Browser API routes (0.0.0.0:8080) ────────────────────────────
BROWSER_STATUS = "/api/status"
BROWSER_APPROVE = "/api/approve/{client_id}"
BROWSER_REJECT = "/api/reject/{client_id}"
BROWSER_PENDING = "/api/pending"
BROWSER_CLIENTS = "/api/clients"
BROWSER_UPLOAD = "/api/upload"
BROWSER_FILES = "/api/files"
BROWSER_FILE_DOWNLOAD = "/api/files/{filepath:path}"

# WebSocket routes
WS_BROWSER = "/ws/client"
WS_EXTENSION = "/internal/ws/events"

# ── Defaults ──────────────────────────────────────────────────────
DEFAULT_PORT = 8080
DEFAULT_INTERNAL_PORT = 8765
DEFAULT_WS_PORT = 8766

# ── Storage files ─────────────────────────────────────────────────
STORAGE_CONFIG = "config.json"
STORAGE_SESSIONS = "sessions.json"
STORAGE_CLIENTS = "clients.json"
STORAGE_ACTIVITY = "activity.json"
