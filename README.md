# LocalShare

Share files between devices on your local network through a web browser.

The receiving device needs nothing installed — just a browser (Android, iPhone, Windows, macOS, Linux).

## How it works

LocalShare is a GNOME Shell extension that runs a small, self-contained backend written in **Rust**.
The backend ships as a prebuilt binary inside the extension, so **no Python, virtualenv, or package
installation is ever needed** — it works out of the box when installed from extensions.gnome.org.

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

## Building the backend

The Rust backend lives in `extension/backend/`. To rebuild the binary:

```bash
cd extension/backend
cargo build --release
```

The release binary is written to `extension/backend/target/release/localshare-backend`.
Copy it to `extension/backend/localshare-backend` before packaging the zip (see below).

## Install

```bash
git clone https://github.com/RightFix/LocalShare.git
cd LocalShare
ln -s "$(pwd)/extension" ~/.local/share/gnome-shell/extensions/localshare@rightfix.com
```

Restart GNOME Shell (Alt+F2, type `r`, Enter) and enable the extension.

## Publish

Build the binary first (see above), then package:

```bash
cp extension/backend/target/release/localshare-backend extension/backend/localshare-backend
rm -f localshare@rightfix.com.zip
cd extension && zip -r ../localshare@rightfix.com.zip . -x 'backend/target/*' 'backend/Cargo.lock' && cd ..
```

The binary is prebuilt per-architecture, so rebuild it on each target architecture before uploading.
Upload the zip at https://extensions.gnome.org/upload/

## License

MIT
