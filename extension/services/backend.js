/* Backend process manager for LocalShare extension.
 *
 * Manages the Python FastAPI backend subprocess lifecycle.
 * The backend runs on 127.0.0.1:8765 and is spawned on demand
 * when the user clicks "Send" or "Receive".
 *
 * On first run, auto-creates a Python venv and installs
 * dependencies so the extension works out of the box when
 * installed from extensions.gnome.org.
 */

'use strict';

const { Gio, GLib } = imports.gi;
const Main = imports.ui.main;
const Self = imports.misc.extensionUtils.getCurrentExtension();
const { httpGet } = imports.services.http;

const INTERNAL_API = 'http://127.0.0.1:8765';
const MAX_RETRIES = 15;
const RETRY_INTERVAL_MS = 500;

let _backendProcess = null;
let _starting = false;
let _installing = false;

function _getExtDir() {
    return Self.dir.get_path();
}

function _getVenvPython() {
    return _getExtDir() + '/venv/bin/python';
}

function _getBackendRunPy() {
    return _getExtDir() + '/backend/run.py';
}

function _getRequirementsTxt() {
    return _getExtDir() + '/requirements.txt';
}

function _notify(title, body) {
    try {
        Main.notify(title, body);
    } catch (e) {
        log('[LocalShare Backend] Notify error: ' + e);
    }
}

function _runSubprocess(args) {
    return new Promise(resolve => {
        try {
            let proc = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.wait_async(null, (proc_, result) => {
                try {
                    let ok = proc_.wait_finish(result);
                    resolve(ok);
                } catch (e) {
                    resolve(false);
                }
            });
        } catch (e) {
            resolve(false);
        }
    });
}

async function _findPython() {
    let candidates = ['python3', 'python3.13', 'python3.12'];
    for (let candidate of candidates) {
        let ok = await _runSubprocess([candidate, '--version']);
        if (ok) {
            log('[LocalShare Backend] Found python: ' + candidate);
            return candidate;
        }
    }
    return null;
}

async function _ensureVenv() {
    let venvPython = _getVenvPython();

    try {
        let venvFile = Gio.File.new_for_path(venvPython);
        if (venvFile.query_exists(null)) {
            log('[LocalShare Backend] Venv python found');
            return true;
        }
    } catch (e) {
        log('[LocalShare Backend] Venv check error: ' + e);
    }

    if (_installing) return false;
    _installing = true;

    _notify('LocalShare', 'Setting up Python environment...');

    let extDir = _getExtDir();
    let pythonBin = await _findPython();

    if (!pythonBin) {
        _notify('LocalShare', 'Python 3.12+ not found. Install it and try again.');
        _installing = false;
        return false;
    }

    log('[LocalShare Backend] Creating venv...');
    let ok = await _runSubprocess([pythonBin, '-m', 'venv', extDir + '/venv']);
    if (!ok) {
        log('[LocalShare Backend] Venv creation failed');
        _notify('LocalShare', 'Failed to create Python environment.');
        _installing = false;
        return false;
    }

    log('[LocalShare Backend] Installing requirements...');
    ok = await _runSubprocess([venvPython, '-m', 'pip', 'install', '-r', _getRequirementsTxt()]);
    if (!ok) {
        log('[LocalShare Backend] Pip install failed');
        _notify('LocalShare', 'Failed to install Python packages. Check your internet connection.');
        _installing = false;
        return false;
    }

    log('[LocalShare Backend] Venv setup complete');
    _notify('LocalShare', 'Python environment ready');
    _installing = false;
    return true;
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

    let venvOk = await _ensureVenv();
    if (!venvOk) {
        log('[LocalShare Backend] Venv setup failed');
        return false;
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
