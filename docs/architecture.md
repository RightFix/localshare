# LocalShare Architecture

## Overview

```
GNOME Shell Extension
        │
        ▼
FastAPI Backend (Internal API — 127.0.0.1:8765)
        │
        ▼
FastAPI Backend (Browser Server — 0.0.0.0:8080)  ← spawned as subprocess
        │
        ▼
Filesystem
```

The GNOME Shell extension is a desktop interface only. All networking,
file I/O, sessions, and real-time events are handled by the Python backend.

---

## Dual-Server Design

| Server | Host | Port | Purpose | Lifetime |
|--------|------|------|---------|----------|
| Internal API | `127.0.0.1` | `8765` | Extension communication | Main process (run.py) |
| Browser Server | `0.0.0.0` | `8080` | Web UI + file upload/download | Spawned/killed by ServerManager |

Both run the same FastAPI `app` instance. The internal API stays
localhost-only; the browser server listens on all interfaces. The
browser server is spawned as a `uvicorn` subprocess by
`ServerManager.start()` and killed by `ServerManager.stop()`.

---

## Data Flow

### Connection & Approval

```
Browser                    Internal API           ServerManager        Storage
  │                             │                     │                  │
  ├─ WS /ws/client ─────────────┤                     │                  │
  │  {device, ip}               │                     │                  │
  │                             ├──add_pending_client─┤                  │
  │                             │                     ├──save client─────┤
  │                             │                     ├──publish event───┤
  │  ◄── {pending, client_id} ──┤                     │                  │
  │                             │                     │                  │
Extension                    Internal API           ServerManager        Storage
  │                             │                     │                  │
  │  (notification shown)       │                     │                  │
  │  POST /internal/approve/id ─┤                     │                  │
  │                             ├──approve_client─────┤                  │
  │                             │                     ├──move pending→connected─┤
  │                             │                     ├──create session────────┤
  │                             │                     ├──publish event─────────┤
  │                             │                     │                  │
Browser                       EventBus               │                  │
  │                             │                     │                  │
  │  ◄── {approved, token} ─────┤                     │                  │
  │  (sets cookie, shows menu)  │                     │                  │
```

### Real-Time Events

All server-side events flow through `EventBus` (pub/sub).

```
ServerManager ──publish──► EventBus ───subscriber──► Browser WS (/ws/client)
                                        └──subscriber──► Extension WS (/internal/ws/events)
```

| Event | Action | Published By | Consumers |
|-------|--------|-------------|-----------|
| `client` | `client_connected` | `add_pending_client` | Browser WS (filter by client_id), Extension WS |
| `client` | `client_approved` | `approve_client` | Browser WS, Extension WS |
| `client` | `client_rejected` | `reject_client` | Browser WS, Extension WS |
| `client` | `client_disconnected` | `disconnect_client` | Browser WS, Extension WS |
| `client` | `sharing_stopped` | `stop` | Browser WS, Extension WS |
| `file` | `upload_completed` | `notify_upload` | Extension WS |
| `file` | `download_completed` | `notify_download` | Extension WS |

---

## API Routes

### Internal API (for GNOME Extension)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/internal/status` | Server status + sharing state |
| GET | `/internal/config` | Full configuration |
| PUT | `/internal/config` | Update config values |
| POST | `/internal/start` | Enable sharing (spawns browser server) |
| POST | `/internal/stop` | Disable sharing (kills subprocess) |
| POST | `/internal/approve/{id}` | Approve a pending client |
| POST | `/internal/reject/{id}` | Reject a pending client |
| GET | `/internal/pending` | List pending clients |
| GET | `/internal/clients` | List connected clients |
| GET | `/internal/ips` | Local IP addresses |
| GET | `/internal/qrcode` | QR code PNG (base64) + URL |

### Browser API

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | None | Web UI (index.html) |
| GET | `/api/status` | Cookie/Header | Session status |
| POST | `/api/approve/{id}` | None | Approve + set session cookie |
| POST | `/api/reject/{id}` | None | Reject client |
| GET | `/api/pending` | None | Pending clients list |
| GET | `/api/clients` | None | Connected clients list |
| POST | `/api/upload` | Session + CSRF | Upload file(s) |
| GET | `/api/files` | Session | List shared files |
| GET | `/api/files/{path}` | Session | Download file |

### WebSocket

| Route | Purpose |
|-------|---------|
| `/ws/client` | Browser approval handshake + real-time push |
| `/internal/ws/events` | Extension real-time push (all events) |

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Unauthenticated access | UUID session tokens, validated on every request |
| Session hijacking | HttpOnly cookies, SameSite=Lax |
| CSRF | Double-submit cookie pattern (X-Session-Token header must match cookie) |
| Directory traversal | `Path.resolve().is_relative_to()` + `".." in Path.parts` |
| Malicious filenames | Sanitized to alphanumeric + `._- `, max 200 chars |
| Arbitrary filesystem access | Uploads restricted to configured upload_dir, downloads to shared_dir |
| Concurrent write corruption | Atomic writes (write-to-tmp then rename) + asyncio.Lock |

---

## Storage

JSON files in `server/data/`:

| File | Model | Purpose |
|------|-------|---------|
| `config.json` | `Config` | Ports, directories, preferences |
| `sessions.json` | `SessionsData` | Approved browser sessions |
| `clients.json` | `ClientsData` | Pending + connected clients |
| `activity.json` | `ActivityData` | Upload/download history |

All access goes through `StorageManager` → `JSONStore` (atomic async).

---

## Project Structure

```
local-share/
├── extension/                     # GNOME Shell extension only
│   ├── extension.js               # Entry point
│   ├── prefs.js                   # Preferences dialog
│   ├── src/
│   │   └── main.js                # Panel indicator and menu
│   ├── services/
│   │   ├── http.js                # Shared HTTP helpers
│   │   └── backend.js             # Backend subprocess lifecycle
│   ├── schemas/                   # GSettings schema
│   ├── metadata.json              # Extension metadata
│   ├── stylesheet.css             # Extension styles
│   ├── install.sh                 # Production install script
│   └── setup.sh                   # Development setup script
├── server/                        # Python backend (separate from extension)
│   ├── backend/
│   │   ├── __init__.py
│   │   ├── main.py                # App factory, lifespan, router includes
│   │   ├── run.py                 # Internal API entry point
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── browser.py         # Browser-facing routes
│   │   │   ├── files.py           # Upload/download routes
│   │   │   └── internal.py        # Extension-facing routes
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   ├── session.py         # Session tokens, HttpOnly cookies
│   │   │   └── dependencies.py    # FastAPI Depends() + CSRF
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── config.py          # Config, ServerStatus
│   │   │   ├── session.py         # Session, SessionsData
│   │   │   ├── client.py          # Client, ClientsData
│   │   │   └── activity.py        # UploadRecord, DownloadRecord, ActivityData
│   │   ├── storage/
│   │   │   ├── __init__.py
│   │   │   ├── json_store.py      # Atomic JSON read/write
│   │   │   └── manager.py         # StorageManager
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── network.py         # IP detection
│   │   │   └── manager.py         # ServerManager (lifecycle, client approval)
│   │   └── websocket/
│   │       ├── __init__.py
│   │       ├── events.py          # EventBus pub/sub
│   │       ├── client.py          # Browser WS handler
│   │       └── extension.py       # Extension WS handler
│   ├── static/                    # Web UI (browser-facing)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   ├── data/                      # Runtime JSON storage
│   └── requirements.txt           # pip dependencies (fastapi, uvicorn, etc.)
├── shared/
│   └── constants.py               # Event/route constants (source of truth)
├── tests/
│   ├── conftest.py                # Shared test fixtures
│   └── backend/                   # 73 pytest tests
├── docs/
│   └── architecture.md            # This file
├── pyproject.toml                 # Project metadata / build config
├── README.md
├── .gitignore
├── .python-version
└── uv.lock                        # Dependency lock file
```
