#!/usr/bin/env bash
set -euo pipefail

# LocalShare — Backend Setup & Run Script (Development Only)
#
# For production installation, use:  ./extension/install.sh
#
# Usage:
#   ./extension/setup.sh          # Set up virtual environment and install deps
#   ./extension/setup.sh run      # Start the backend using the venv

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")/server"
VENV_DIR="$SCRIPT_DIR/venv"
REQUIREMENTS="$SERVER_DIR/requirements.txt"

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

# ── Setup: create venv + install deps ─────────────────────────────
setup() {
    local PYTHON
    PYTHON=$(find_python) || {
        echo "Error: Python 3.12+ is required but not found."
        echo "Install it with your package manager, e.g.:"
        echo "  sudo apt install python3 python3-venv python3-pip"
        exit 1
    }

    echo "==> Setting up LocalShare backend"
    echo "    Extension: $SCRIPT_DIR"
    echo "    Python:    $($PYTHON --version)"
    echo ""

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
        echo "Error: $REQUIREMENTS not found"
        exit 1
    fi

    echo "==> Installing dependencies..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade pip
    "$VENV_DIR/bin/pip" install --quiet -r "$REQUIREMENTS"
    echo "    Done"

    mkdir -p "$SERVER_DIR/backend/data"
    echo ""
    echo "==> Setup complete."
    echo "    Run:  ./extension/setup.sh run"
}

# ── Run: start backend using venv ──────────────────────────────────
run() {
    if [ ! -d "$VENV_DIR" ] || [ ! -f "$VENV_DIR/bin/python" ]; then
        echo "Virtual environment not found."
        echo "Run setup first:  ./extension/setup.sh"
        exit 1
    fi

    echo "==> Starting LocalShare backend..."
    exec "$VENV_DIR/bin/python" "$SERVER_DIR/backend/run.py" "$@"
}

# ── Dispatch ───────────────────────────────────────────────────────
case "${1:-setup}" in
    setup) setup ;;
    run) shift; run "$@" ;;
    *)
        echo "Usage: $0 [setup|run]"
        exit 1
        ;;
esac
