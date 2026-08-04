# LocalShare

Share files between devices on your local network through a web browser.

The receiving device needs nothing installed — just a browser (Android, iPhone, Windows, macOS, Linux).

## Features

- Share and receive files from the GNOME Shell panel
- Desktop notifications for connection requests and uploads
- Per-device approval — no passwords or accounts
- Drag-and-drop uploads and folder browsing from any browser on your network
- No file size limits, active until you turn it off

## Requirements

- GNOME Shell 48, 49, or 50
- Python 3.12+

## Install

```bash
git clone https://github.com/RightFix/LocalShare.git
cd LocalShare
./extension/setup.sh          # create venv + install dependencies
ln -s "$(pwd)/extension" ~/.local/share/gnome-shell/extensions/localshare@rightfix.com
```

Restart GNOME Shell (Alt+F2, type `r`, Enter) and enable the extension.

## Usage

1. Click the LocalShare icon in the top panel.
2. Choose **Send** or **Receive**.
3. Other devices open the shown URL in their browser.
4. Approve or reject connection requests from the menu.

## Development

```bash
./extension/setup.sh run      # start the backend (uses the venv)
```

## Publish

```bash
cd extension && zip -r ../localshare@rightfix.com.zip . -x 'venv/*' '.venv/*' '*/__pycache__/*' 'data/*' '*.pyc' && cd ..
```

Upload the zip at https://extensions.gnome.org/upload/

## License

MIT
