/* Backend process manager for LocalShare extension.
 *
 * Manages the compiled Rust backend subprocess lifecycle.
 * The backend runs on 127.0.0.1:<internal-port> and is spawned on demand
 * when the user clicks "Send" or "Receive".
 *
 * The backend ships as a prebuilt, self-contained binary inside the
 * extension directory (backend-rust/localshare-backend), so no Python,
 * venv, or package installation is ever required at runtime. Runtime
 * JSON data lives under $XDG_DATA_HOME/localshare.
 */

'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { httpGet } from './http.js';

const MAX_RETRIES = 15;
const RETRY_INTERVAL_MS = 500;

let _extensionDir = null;
let _dataDir = null;
let _internalPort = 8765;

let _backendProcess = null;
let _starting = false;

function _internalBase() {
    return 'http://127.0.0.1:' + _internalPort;
}

export function init(extensionDir, settings) {
    _extensionDir = extensionDir;
    _internalPort = settings.get_int('internal-port');
    _dataDir = GLib.get_user_data_dir() + '/localshare';
}

function _getBackendBinary() {
    return _extensionDir + '/backend-rust/localshare-backend';
}

function _notify(title, body) {
    try {
        Main.notify(title, body);
    } catch (e) {
        log('[LocalShare Backend] Notify error: ' + e);
    }
}

function _ensureDataDir() {
    try {
        Gio.File.new_for_path(_dataDir).make_directory_with_parents(null);
    } catch (e) {
        log('[LocalShare Backend] Data dir error: ' + e);
    }
}

function _isProcessRunning() {
    if (!_backendProcess) return false;
    try {
        return _backendProcess.get_if_running();
    } catch (e) {
        return false;
    }
}

async function _checkServer() {
    try {
        await httpGet(_internalBase() + '/internal/status');
        return true;
    } catch (e) {
        return false;
    }
}

function _spawnBackend() {
    if (_isProcessRunning()) return true;

    let binary = _getBackendBinary();
    let binaryFile = Gio.File.new_for_path(binary);
    if (!binaryFile.query_exists(null)) {
        log('[LocalShare Backend] Backend binary not found: ' + binary);
        _notify('LocalShare', 'Backend binary is missing. Reinstall the extension.');
        return false;
    }

    let args = [
        binary,
        '--internal-port',
        String(_internalPort),
        '--data-dir',
        _dataDir
    ];

    log('[LocalShare Backend] Spawning: ' + args.join(' '));

    try {
        _backendProcess = Gio.Subprocess.new(
            args,
            Gio.SubprocessFlags.NONE
        );
        return true;
    } catch (e) {
        log('[LocalShare Backend] Spawn error: ' + e);
        return false;
    }
}

function _killBackend() {
    if (!_backendProcess)
        return;

    let proc = _backendProcess;
    _backendProcess = null;

    try {
        proc.send_signal(15);
    } catch (e) {
        log('[LocalShare Backend] Send signal error: ' + e);
    }

    proc.wait_check_async(null, (proc_, result) => {
        try {
            proc_.wait_check_finish(result);
        } catch (e) {
            log('[LocalShare Backend] Wait error: ' + e);
        }
    });

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        let running = false;
        try {
            running = proc.get_if_running();
        } catch (e) {
            log('[LocalShare Backend] Process state error: ' + e);
        }
        if (running) {
            try {
                proc.force_exit();
            } catch (e) {
                log('[LocalShare Backend] Force exit error: ' + e);
            }
        }
        return GLib.SOURCE_REMOVE;
    });
}

function _delay(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

export var ensureBackend = async function () {
    if (_starting) {
        log('[LocalShare Backend] Already starting, waiting...');
        for (let i = 0; i < MAX_RETRIES; i++) {
            await _delay(RETRY_INTERVAL_MS);
            if (await _checkServer()) return true;
            if (!_starting) return false;
        }
        return false;
    }

    if (await _checkServer()) {
        log('[LocalShare Backend] Already running');
        return true;
    }

    _starting = true;
    log('[LocalShare Backend] Setting up backend...');

    _ensureDataDir();

    log('[LocalShare Backend] Starting backend...');

    if (!_spawnBackend()) {
        _starting = false;
        return false;
    }

    for (let i = 0; i < MAX_RETRIES; i++) {
        await _delay(RETRY_INTERVAL_MS);
        if (await _checkServer()) {
            log('[LocalShare Backend] Ready');
            _starting = false;
            return true;
        }
        if (!_isProcessRunning()) {
            log('[LocalShare Backend] Process died during startup');
            _starting = false;
            return false;
        }
    }

    log('[LocalShare Backend] Timed out waiting for server');
    _killBackend();
    _starting = false;
    return false;
};

export var stopBackend = function () {
    _starting = false;
    if (_backendProcess) {
        log('[LocalShare Backend] Stopping...');
        _killBackend();
    }
};

export var isBackendRunning = function () {
    return _isProcessRunning();
};
