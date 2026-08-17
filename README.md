# LocalShare

Share files between devices on your local network through a web browser.

The receiving device needs nothing installed — just a browser (Android, iPhone, Windows, macOS, Linux).

## Requirements

- GNOME Shell 48, 49, or 50

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
- **Send** — pick specific files (e.g. a PDF you want to hand over). Visitors can only see and
  download those files — nothing else on your disk. No temporary copies or symlinks are involved,
  so your data is never duplicated.

## Install

1. Download `localshare@rightfix.com.zip` from the
   [releases page](https://github.com/RightFix/LocalShare/releases).
2. Open a terminal in the folder where you downloaded the zip, then run:

   ```bash
   rm -rf ~/.local/share/gnome-shell/extensions/localshare@rightfix.com
   unzip localshare@rightfix.com.zip
   cp -r localshare@rightfix.com ~/.local/share/gnome-shell/extensions/
   ```

3. Restart your computer (or log out and back in) so GNOME Shell picks up the extension, then
   enable **Local Share** in the Extensions app.

## How it works

LocalShare is a GNOME Shell extension that runs a small, self-contained Rust backend. The backend ships as a prebuilt binary inside the extension. It serves a web UI on your local network that other devices connect to from their browser  the extension approves each connection through a desktop notification.

## License

MIT
