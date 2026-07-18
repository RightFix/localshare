#!/usr/bin/env bash
set -euo pipefail

# LocalShare — Production Installation Script
#
# Deploys the extension to GNOME Shell and sets up the Python backend.
#
# Usage:
#   ./extension/install.sh          # Install / update the extension
#   ./extension/install.sh --force  # Force reinstall (remove existing first)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_UUID="localshare@rightfix.com"
EXT_TARGET="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"
FORCE="${1:-}"

# ── Detect Python 3.12+ ────────────────────────────────────────────
find_python() {
    for cmd in python3.12 python3.13 python3; do
        if command -v "$cmd" &>/dev/null; then
            ver=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
            major=${ver%.*}; minor=${ver#*.}
            if [ "$major" -ge 3 ] && [ "$minor" -ge 12 ]; then
                echo "$cmd"
                return 0
            fi
        fi
    done
    return 1
}

# ── Install ─────────────────────────────────────────────────────────
install() {
    echo "==> Installing LocalShare GNOME Extension"
    echo ""

    # ── Python check ──────────────────────────────────────────────
    local PYTHON
    PYTHON=$(find_python) || {
        echo "Error: Python 3.12+ is required but not found."
        echo "Install it with your package manager, e.g.:"
        echo "  sudo apt install python3 python3-venv python3-pip"
        exit 1
    }
    echo "    Python:  $($PYTHON --version)"

    # ── Clean previous install if --force ─────────────────────────
    if [ "$FORCE" = "--force" ]; then
        echo "==> Removing previous installation..."
        gnome-extensions disable "$EXT_UUID" 2>/dev/null || true
        rm -rf "$EXT_TARGET"
    fi

    # ── Copy extension files ──────────────────────────────────────
    echo "==> Deploying extension to $EXT_TARGET"
    mkdir -p "$EXT_TARGET"
    rsync -a --delete \
        --exclude='venv/' \
        --exclude='__pycache__/' \
        --exclude='*.pyc' \
        --exclude='.gitignore' \
        "$SCRIPT_DIR/" "$EXT_TARGET/"

    echo "==> Extension files deployed"

    # ── Deploy server (Python backend + web UI) ────────────────────
    local SERVER_DIR="$(dirname "$SCRIPT_DIR")/server"
    echo "==> Deploying Python backend"
    mkdir -p "$EXT_TARGET/backend"
    rsync -a --delete \
        --exclude='__pycache__/' \
        --exclude='*.pyc' \
        --exclude='data/' \
        "$SERVER_DIR/backend/" "$EXT_TARGET/backend/"
    rsync -a "$SERVER_DIR/requirements.txt" "$EXT_TARGET/requirements.txt"

    echo "==> Backend files deployed"

    # ── Deploy shared constants ────────────────────────────────────
    echo "==> Deploying shared constants"
    mkdir -p "$EXT_TARGET/shared"
    rsync -a --delete \
        --exclude='__pycache__/' \
        --exclude='*.pyc' \
        "$SERVER_DIR/../shared/" "$EXT_TARGET/shared/"

    # ── Create venv ───────────────────────────────────────────────
    local VENV_DIR="$EXT_TARGET/venv"
    local REQUIREMENTS="$EXT_TARGET/requirements.txt"

    if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/pip" ]; then
        echo "==> Virtual environment exists at $VENV_DIR"
    elif [ -d "$VENV_DIR" ] && [ ! -f "$VENV_DIR/bin/pip" ]; then
        echo "==> Recreating venv (existing one is missing pip)..."
        rm -rf "$VENV_DIR"
        "$PYTHON" -m venv "$VENV_DIR"
    else
        echo "==> Creating virtual environment..."
        "$PYTHON" -m venv "$VENV_DIR"
    fi

    if [ ! -f "$REQUIREMENTS" ]; then
        echo "Error: $REQUIREMENTS not found in deployed extension"
        exit 1
    fi

    echo "==> Installing Python dependencies..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade pip
    "$VENV_DIR/bin/pip" install --quiet -r "$REQUIREMENTS"
    echo "    Done"

    mkdir -p "$EXT_TARGET/backend/data"

    # ── Compile GSettings schemas ──────────────────────────────────
    local SCHEMA_DIR="$EXT_TARGET/schemas"
    if [ -d "$SCHEMA_DIR" ] && command -v glib-compile-schemas &>/dev/null; then
        echo "==> Compiling GSettings schemas..."
        glib-compile-schemas "$SCHEMA_DIR"
    elif [ -d "$SCHEMA_DIR" ]; then
        echo "!! glib-compile-schemas not found — schemas not compiled"
    fi

    # ── Enable extension ──────────────────────────────────────────
    if command -v gnome-extensions &>/dev/null; then
        echo "==> Enabling extension..."
        gnome-extensions enable "$EXT_UUID" 2>/dev/null || {
            echo "!! Could not enable extension. You may need to restart GNOME Shell"
            echo "   (Alt+F2, type 'r', Enter), then enable manually in Extensions app."
        }
    else
        echo "!! gnome-extensions command not found."
        echo "   Enable '$EXT_UUID' manually in the Extensions app after restarting GNOME Shell."
    fi

    echo ""
    echo "==> Installation complete!"
    echo "    Restart GNOME Shell (Alt+F2, type 'r', Enter) if the extension isn't visible."
}

install
