/* Backend process manager for LocalShare extension.
 *
 * Manages the Python FastAPI backend subprocess lifecycle.
 * The backend runs on 127.0.0.1:8765 and is spawned on demand
 * when the user clicks "Start Sharing".
 */

'use strict';

const { Gio, GLib } = imports.gi;
const Self = imports.misc.extensionUtils.getCurrentExtension();
const { httpGet } = imports.services.http;

const INTERNAL_API = 'http://127.0.0.1:8765';
const MAX_RETRIES = 15;
const RETRY_INTERVAL_MS = 500;

let _backendProcess = null;
let _starting = false;

function _getVenvPython() {
    return Self.dir.get_path() + '/venv/bin/python';
}

function _getBackendRunPy() {
    return Self.dir.get_path() + '/backend/run.py';
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
        await httpGet(INTERNAL_API + '/internal/status');
        return true;
    } catch (e) {
        return false;
    }
}

function _spawnBackend() {
    if (_isProcessRunning()) return true;

    let python = _getVenvPython();
    let script = _getBackendRunPy();

    log('[LocalShare Backend] Spawning: ' + python + ' ' + script);

    try {
        _backendProcess = Gio.Subprocess.new(
            [python, script],
            Gio.SubprocessFlags.NONE
        );
        return true;
    } catch (e) {
        log('[LocalShare Backend] Spawn error: ' + e);
        return false;
    }
}

function _killBackend() {
    if (!_backendProcess) return;
    try {
        _backendProcess.send_signal(15);
        _backendProcess.wait(2000);
    } catch (e) {
        log('[LocalShare Backend] Kill error: ' + e);
    }
    if (_isProcessRunning()) {
        try {
            _backendProcess.force_exit();
        } catch (e) {
            log('[LocalShare Backend] Force exit error: ' + e);
        }
    }
    _backendProcess = null;
}

function _delay(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

var ensureBackend = async function () {
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

var stopBackend = function () {
    _starting = false;
    if (_backendProcess) {
        log('[LocalShare Backend] Stopping...');
        _killBackend();
    }
};

var isBackendRunning = function () {
    return _isProcessRunning();
};
