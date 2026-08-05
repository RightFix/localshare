/* Backend process manager for LocalShare extension.
 *
 * Manages the Python FastAPI backend subprocess lifecycle.
 * The backend runs on 127.0.0.1:<internal-port> and is spawned on demand
 * when the user clicks "Send" or "Receive".
 *
 * On first run, auto-creates a Python venv and installs
 * dependencies so the extension works out of the box when
 * installed from extensions.gnome.org. All runtime data and
 * the virtual environment live under $XDG_DATA_HOME/localshare,
 * never inside the extension install directory.
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
let _installing = false;

function _internalBase() {
    return 'http://127.0.0.1:' + _internalPort;
}

export function init(extensionDir, settings) {
    _extensionDir = extensionDir;
    _internalPort = settings.get_int('internal-port');
    _dataDir = GLib.get_user_data_dir() + '/localshare';
}

function _getVenvPython() {
    return _dataDir + '/venv/bin/python';
}

function _getBackendRunPy() {
    return _extensionDir + '/backend/run.py';
}

function _getRequirementsTxt() {
    return _extensionDir + '/backend/requirements.txt';
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

    _ensureDataDir();
    let pythonBin = await _findPython();

    if (!pythonBin) {
        _notify('LocalShare', 'Python 3.12+ not found. Install it and try again.');
        _installing = false;
        return false;
    }

    log('[LocalShare Backend] Creating venv...');
    let ok = await _runSubprocess([pythonBin, '-m', 'venv', _dataDir + '/venv']);
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
        await httpGet(_internalBase() + '/internal/status');
        return true;
    } catch (e) {
        return false;
    }
}

function _spawnBackend() {
    if (_isProcessRunning()) return true;

    let python = _getVenvPython();
    let script = _getBackendRunPy();
    let args = [
        python,
        script,
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
