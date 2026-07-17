# LocalShare

Share files between devices on your local network through a web browser.

The receiving device needs **zero installation** — just a browser. Works with Android, iPhone, Windows, macOS, Linux, and anything else with a modern browser.

```
GNOME Shell Extension  ──HTTP──►  FastAPI Backend  ──►  Filesystem
```

## Features

- **One-click sharing** from the GNOME Shell top panel
- **Desktop notifications** for connection requests and uploads
- **Per-client approval** — no passwords, no accounts
- **Drag-and-drop upload** from any browser on your network
- **File browsing and download** with folder navigation

- **Responsive web UI** works on phones and tablets
- **Multiple simultaneous users
- **No file size limits**
- **No sharing timeout** — stays active until you turn it off

## Requirements

- Python 3.12+
- GNOME Shell 48, 49, or 50

## Installation

### Production Install (Recommended)

```bash
git clone https://github.com/RightFix/LocalShare.git
cd LocalShare
./extension/install.sh
```

The install script will:
- Deploy the extension to `~/.local/share/gnome-shell/extensions/localshare@rightfix.com/`
- Create a Python virtual environment inside the extension directory
- Install all Python dependencies
- Compile GSettings schemas
- Enable the extension

Then restart GNOME Shell (Alt+F2, type `r`, Enter).

### Development Setup

```bash
git clone https://github.com/RightFix/LocalShare.git
cd LocalShare
./extension/setup.sh          # Create venv and install deps
./extension/setup.sh run      # Start the backend
```

Symlink the extension for development:

```bash
ln -sf "$(pwd)/extension" ~/.local/share/gnome-shell/extensions/localshare@rightfix.com
```

## Usage

### From the panel

1. Click the LocalShare icon in the top-right panel
2. Click **Send** to share files from your PC, or **Receive** to accept uploads
3. Other devices access the web UI at the displayed URL
4. Approve or reject connection requests from the menu

## Development

```bash
# Install dev dependencies
uv sync --dev

# Run tests
uv run pytest

# Lint
uv run ruff check

# Start backend directly (without extension)
uv run python extension/backend/run.py
```

### Project structure

```
├── extension/             # Self-contained GNOME Shell extension + backend
│   ├── backend/           # Python FastAPI backend
│   │   ├── main.py        # App factory, lifespan, router includes
│   │   ├── run.py         # Internal API entry point
│   │   ├── api/           # Route handlers (browser, files, internal)
│   │   ├── auth/          # Session tokens, CSRF protection
│   │   ├── models/        # Pydantic data models
│   │   ├── storage/       # Atomic JSON file storage
│   │   ├── services/      # Business logic (server management, network)
│   │   ├── websocket/     # EventBus pub/sub, WS handlers
│   │   └── static/        # Web UI (index.html, CSS, JS)
│   ├── src/main.js        # Panel indicator and menu
│   ├── prefs.js           # Extensions app preferences dialog
│   ├── services/
│   │   ├── http.js        # Shared HTTP helpers
│   │   └── backend.js     # Backend process lifecycle manager
│   ├── schemas/           # GSettings schema
│   ├── metadata.json      # Extension metadata
│   ├── setup.sh           # Development setup script
│   ├── install.sh         # Production install script
│   └── requirements.txt   # pip dependencies
├── tests/                 # Test suite (73 tests)
├── docs/                  # Architecture documentation
├── shared/                # Shared constants
└── pyproject.toml         # Project config + uv dependencies
```

## Publishing to GNOME Extensions

```bash
# Package the extension (zip contents at root, filename = UUID)
cd extension && zip -r ../localshare@rightfix.com.zip . -x 'install.sh' && cd ..
```

Then upload `localshare@rightfix.com.zip` at https://extensions.gnome.org/upload/

## Security

- **No passwords** — desktop approval via notification
- **Session tokens** — UUID-based, stored in HttpOnly cookies
- **CSRF protection** — double-submit cookie pattern
- **Path traversal prevention** — resolved paths validated against allowed directories
- **Atomic writes** — JSON files written atomically to prevent corruption

## License

MIT
