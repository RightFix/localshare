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

1. A device opens the shown URL, and its browser connects to the client websocket, announcing
   itself with a device name derived from its browser user agent (e.g. "Firefox on Linux").
2. The extension shows an interactive notification with **Accept / Decline** buttons. The
   notification is persistent (it stays in the notification center) until you respond, so it
   won't be missed even if you step away.
3. On approval, a session token is created and pushed back through the event bus to the browser.
4. The browser is now authenticated and can upload or download files.

**Libraries**

Backend (Rust crates):

- axum 0.8 — HTTP/WebSocket web framework
- tokio 1 — async runtime
- serde 1 / serde_json 1 — serialization
- uuid 1 (v4) — session and client IDs
- chrono 0.4 — timestamps
- rust-embed 8 — embeds the web UI into the binary
- local-ip-address 0.6 — LAN IP detection
- tokio-util 0.7 — streaming helpers
- futures-util 0.3 — async utilities

Extension (GJS / GNOME Shell APIs):

- Gio, GLib, GObject, St, Soup
- Adw + Gtk 4.0 (preferences window)
- GNOME Shell modules: ui/main, ui/messageTray, ui/panelMenu, ui/popupMenu

Web frontend: no libraries — plain HTML/CSS/JS.

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
4. A persistent notification appears on your screen — click **Accept** or **Decline** to allow or
   block the connection.

**Where files go (default: your `Public` directory)**

- By default both uploads and downloads use `~/Public` on your machine:
  - **Uploads** (files visitors send to you) are saved into `~/Public`.
  - **Downloads** (files visitors fetch from you) are served from `~/Public`.
- You can change these locations at any time in the extension's **Settings** window
  (click **Settings** in the panel menu). The **Upload Directory** and **Shared Directory**
  pickers let you point them anywhere you like.
- Use the **Browse Shared Files** button in the web UI to confirm which files are currently
  visible, or drop files onto the page to upload them into your upload directory.

**Send vs Receive**

- **Receive** — shares a folder on your machine (default `~/Public`). Visitors can browse and
  download anything in it, and upload files into it.
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
cd extension && zip -r ../localshare@rightfix.com.zip . \
    -x 'backend/target/*' 'backend/Cargo.lock' 'backend/Cargo.toml' \
       'backend/src/*' 'backend/assets/*' && cd ..
```

The binary is prebuilt per-architecture, so rebuild it on each target architecture before uploading.
Upload the zip at https://extensions.gnome.org/upload/

## License

MIT
