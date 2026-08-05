# LocalShare

Share files between devices on your local network through a web browser.

The receiving device needs nothing installed — just a browser (Android, iPhone, Windows, macOS, Linux).

## How it works

LocalShare is a GNOME Shell extension that runs a small Python backend on your machine.

On first use the extension sets up everything itself: it creates a Python virtualenv under
`$XDG_DATA_HOME/localshare/venv`, installs the backend dependencies, and starts the backend process.
Nothing needs to be configured manually.

The backend runs **two servers in a single process**, sharing one storage layer and one event bus:

- **Internal server** (loopback only, `127.0.0.1:8765`) — the API the extension talks to, plus the
  extension's websocket (`/internal/ws/events`). Only reachable from your machine.
- **Browser server** (LAN, port 8080 by default) — the web UI, file upload/download endpoints
  (`/api/*`), and the client websocket (`/ws/client`). This is what other devices connect to.

Both servers share the same in-memory state, so when a browser connects the extension hears about it
instantly through the event bus.

**Connection flow**

1. A device opens the shown URL, and its browser connects to the client websocket.
2. The extension shows a notification asking you to approve or reject the device.
3. On approval, a session token is created and pushed back through the event bus to the browser.
4. The browser is now authenticated and can upload or download files.

**File transfer**

- Uploads are streamed straight to disk in chunks into the folder you picked, with no size limits.
- Downloads are served directly from disk, with path traversal and symlink escape attempts blocked.
- Progress and completions arrive as desktop notifications (`upload_completed`, `download_completed`).
- State (config, pending clients, sessions, activity) is persisted as JSON files with atomic writes,
  so a restart loses nothing important.

## Usage

1. Click the LocalShare icon in the top panel.
2. Choose **Send** or **Receive**.
3. Other devices open the shown URL in their browser.
4. Approve or reject connection requests from the menu.

**Send vs Receive**

- **Receive** — shares a folder on your machine. Visitors can browse and download anything in it,
  and upload files into it.
- **Send** — pick specific files (e.g. a PDF you want to hand over). The extension registers those
  exact files with the backend over the loopback API, and visitors can only see and download those
  files — nothing else on your disk. No temporary copies or symlinks are involved, so your data is
  never duplicated.

## Requirements

- GNOME Shell 48, 49, or 50
- Python 3.12+

## Install

```bash
git clone https://github.com/RightFix/LocalShare.git
cd LocalShare
ln -s "$(pwd)/extension" ~/.local/share/gnome-shell/extensions/localshare@rightfix.com
```

Restart GNOME Shell (Alt+F2, type `r`, Enter) and enable the extension.

## Publish

```bash
cd extension && zip -r ../localshare@rightfix.com.zip . -x '*/.venv/*' '*/__pycache__/*' '*.pyc' 'data/*' 'backend/data/*' 'backend/uv.lock' 'backend/pyproject.toml' && cd ..
```

Upload the zip at https://extensions.gnome.org/upload/

## License

MIT
