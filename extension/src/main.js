'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import Gtk from 'gi://Gtk?version=4.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Button as PanelMenuButton } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {
    PopupMenuItem,
    PopupMenuSection,
    PopupSeparatorMenuItem
} from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { getSession, httpGet, httpPost, httpPut } from './services/http.js';
import { init as initBackend, ensureBackend, stopBackend } from './services/backend.js';

const WS_RECONNECT_DELAY = 3000;
const POLL_INTERVAL = 3000;

let _extension = null;
let _settings = null;
let indicator = null;
let pollTimer = null;
let wsConnection = null;
let wsReconnectId = null;
let wsEnabled = false;

function _internalBase() {
    return 'http://127.0.0.1:' + _settings.get_int('internal-port');
}

function _wsUrl() {
    return 'ws://127.0.0.1:' + _settings.get_int('internal-port') + '/internal/ws/events';
}

function notify(title, body) {
    try {
        Main.notify(title, body);
    } catch (e) {
        log('[LocalShare] Notify error: ' + e);
    }
}

export function enable(extension) {
    log('[LocalShare] Enable');
    _extension = extension;
    _settings = extension.getSettings();
    initBackend(extension.dir.get_path(), _settings);
    indicator = new LocalShareIndicator();

    if (_settings.get_boolean('auto-start'))
        indicator._autoStart();
}

export function disable() {
    log('[LocalShare] Disable');
    _stopPolling();
    _disconnectWS();
    if (indicator) {
        indicator._mode = null;
    }
    stopBackend();
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
}

function _startPolling() {
    if (pollTimer)
        return;
    pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL, () => {
        if (indicator)
            indicator._refresh();
        return GLib.SOURCE_CONTINUE;
    });
}

function _stopPolling() {
    if (pollTimer) {
        GLib.source_remove(pollTimer);
        pollTimer = null;
    }
}

function _connectWS() {
    if (!wsEnabled)
        return;
    if (wsConnection)
        return;

    try {
        let session = getSession();
        let uri = GLib.Uri.parse(_wsUrl(), GLib.UriFlags.NONE);
        let msg = new Soup.Message({ method: 'GET', uri: uri });

        session.websocket_connect_async(msg, null, null, null, (session_, result) => {
            try {
                wsConnection = session_.websocket_connect_finish(result);
                log('[LocalShare] WS connected');

                wsConnection.connect('message', (conn, type, data) => {
                    try {
                        let text = new TextDecoder().decode(data.get_data());
                        let msg = JSON.parse(text);
                        if (indicator)
                            indicator._handleWSEvent(msg.event, msg.data);
                    } catch (e) {
                        log('[LocalShare] WS msg error: ' + e);
                    }
                });

                wsConnection.connect('closed', () => {
                    log('[LocalShare] WS closed');
                    wsConnection = null;
                    if (wsEnabled)
                        _scheduleWSReconnect();
                });
            } catch (e) {
                log('[LocalShare] WS connect error: ' + e);
                wsConnection = null;
                _scheduleWSReconnect();
            }
        });
    } catch (e) {
        log('[LocalShare] WS init error: ' + e);
        _scheduleWSReconnect();
    }
}

function _scheduleWSReconnect() {
    if (wsReconnectId)
        return;
    wsReconnectId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WS_RECONNECT_DELAY, () => {
        wsReconnectId = null;
        _connectWS();
        return GLib.SOURCE_REMOVE;
    });
}

function _disconnectWS() {
    wsEnabled = false;
    if (wsReconnectId) {
        GLib.source_remove(wsReconnectId);
        wsReconnectId = null;
    }
    if (wsConnection) {
        try {
            wsConnection.close(1000, 'Extension disabled');
        } catch (e) {
            log('[LocalShare] WS close error: ' + e);
        }
        wsConnection = null;
    }
}

var LocalShareIndicator = GObject.registerClass(
    class LocalShareIndicator extends PanelMenuButton {
        _init() {
            super._init(0.0, 'LocalShare', false);

            this._mode = null;
            this._shareUrl = null;
            this._knownPendingIds = [];
            this._dynamicItems = [];

            let icon = new St.Icon({
                icon_name: 'network-server-symbolic',
                style_class: 'system-status-icon localshare-indicator'
            });
            this.add_child(icon);

            this._header = new PopupMenuItem('LocalShare', { reactive: false });
            this._header.label.add_style_class_name('localshare-header-label');
            this.menu.addMenuItem(this._header);

            this.menu.addMenuItem(new PopupSeparatorMenuItem());

            this._dynamicSection = new PopupMenuSection();
            this.menu.addMenuItem(this._dynamicSection);

            this.menu.addMenuItem(new PopupSeparatorMenuItem());

            let settingsItem = new PopupMenuItem('Settings');
            settingsItem.connect('activate', () => this._openSettings());
            this.menu.addMenuItem(settingsItem);
        }

        _addDynamicItem(item) {
            this._dynamicSection.addMenuItem(item);
            this._dynamicItems.push(item);
        }

        _rebuildMenu() {
            this._clearSection();
            this._dynamicItems = [];

            if (this._mode === 'sending') {
                let stopItem = new PopupMenuItem('Stop Sending');
                stopItem.connect('activate', () => this._onStopSending());
                this._addDynamicItem(stopItem);

                let urlItem = new PopupMenuItem(this._shareUrl || 'URL: unknown', {
                    reactive: false
                });
                this._addDynamicItem(urlItem);
            } else if (this._mode === 'receiving') {
                let stopItem = new PopupMenuItem('Stop Receiving');
                stopItem.connect('activate', () => this._onStop());
                this._addDynamicItem(stopItem);

                let urlItem = new PopupMenuItem(this._shareUrl || 'URL: unknown', {
                    reactive: false
                });
                this._addDynamicItem(urlItem);
            } else {
                let sendItem = new PopupMenuItem('Send');
                sendItem.connect('activate', () => this._onSend());
                this._addDynamicItem(sendItem);

                let recvItem = new PopupMenuItem('Receive');
                recvItem.connect('activate', () => this._onReceive());
                this._addDynamicItem(recvItem);
            }
        }

        _clearSection() {
            for (let i = this._dynamicItems.length - 1; i >= 0; i--) {
                this._dynamicItems[i].destroy();
            }
            this._dynamicItems = [];
        }

        _handleWSEvent(event, data) {
            if (!data)
                return;

            switch (data.action) {
                case 'client_connected':
                    this._addPendingClient(data);
                    break;
                case 'client_approved':
                case 'client_rejected':
                case 'client_disconnected':
                    this._refresh();
                    break;
                case 'sharing_stopped':
                    notify('Sharing Stopped', 'File sharing has been disabled');
                    this._mode = null;
                    this._rebuildMenu();
                    break;
                case 'upload_completed':
                    if (_settings.get_boolean('notify-on-upload'))
                        notify('File Received', data.filename + ' from ' + (data.from_device || 'unknown'));
                    break;
                case 'download_completed':
                    if (_settings.get_boolean('notify-on-download'))
                        notify('File Downloaded', data.filename + ' by ' + (data.to_device || 'unknown'));
                    break;
                default:
                    break;
            }
        }

        _addPendingClient(data) {
            if (this._knownPendingIds.indexOf(data.client_id) !== -1)
                return;
            this._knownPendingIds.push(data.client_id);
            notify(
                'Connection Request',
                (data.device || 'Unknown') + ' from ' + (data.ip || 'Unknown') + ' wants to connect'
            );
            this._refresh();
        }

        _buildStartPayload(sharedDir) {
            let payload = {
                port: _settings.get_int('port'),
                internal_port: _settings.get_int('internal-port')
            };
            if (sharedDir)
                payload.shared_dir = sharedDir;
            let uploadDir = _settings.get_string('upload-dir');
            if (uploadDir)
                payload.upload_dir = uploadDir;
            return payload;
        }

        _pickFiles() {
            return new Promise(resolve => {
                let chooser = new Gtk.FileChooserNative({
                    title: 'Select files to send',
                    action: Gtk.FileChooserAction.OPEN,
                    select_multiple: true,
                    modal: true
                });

                chooser.connect('response', (widget, response) => {
                    if (response === Gtk.ResponseType.ACCEPT) {
                        let files = [];
                        let model = chooser.get_files();
                        for (let i = 0; i < model.get_n_items(); i++)
                            files.push(model.get_item(i));
                        resolve(files);
                    } else {
                        resolve(null);
                    }
                    chooser.destroy();
                });

                chooser.show();
            });
        }

        async _autoStart() {
            try {
                let ok = await ensureBackend();
                if (!ok) {
                    notify('LocalShare', 'Failed to start backend.');
                    return;
                }

                await httpPost(_internalBase() + '/internal/start', this._buildStartPayload(null));

                let status = await httpGet(_internalBase() + '/internal/status');
                let ipsData = await httpGet(_internalBase() + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || _settings.get_int('port'));

                this._mode = 'receiving';
                this._rebuildMenu();
                this._refresh();
                _startPolling();
                wsEnabled = true;
                _connectWS();
                notify('LocalShare', 'Sharing started at ' + this._shareUrl);
            } catch (e) {
                log('[LocalShare] Auto-start error: ' + e);
                notify('LocalShare', 'Failed to start. Make sure the server is installed.');
            }
        }

        async _onSend() {
            try {
                let ok = await ensureBackend();
                if (!ok) {
                    notify('LocalShare', 'Failed to start backend.');
                    return;
                }

                if (this._mode === 'receiving') {
                    await httpPost(_internalBase() + '/internal/stop');
                    this._mode = null;
                    this._knownPendingIds = [];
                }

                let files = await this._pickFiles();
                if (!files || files.length === 0)
                    return;

                await httpPost(_internalBase() + '/internal/start', this._buildStartPayload(null));

                let paths = [];
                for (let i = 0; i < files.length; i++)
                    paths.push(files[i].get_path());
                await httpPut(_internalBase() + '/internal/send-files', { files: paths });

                let status = await httpGet(_internalBase() + '/internal/status');
                let ipsData = await httpGet(_internalBase() + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || _settings.get_int('port'));

                notify('LocalShare', 'Sending files at ' + this._shareUrl);

                this._mode = 'sending';
                this._rebuildMenu();
                this._refresh();
                _startPolling();
                wsEnabled = true;
                _connectWS();
            } catch (e) {
                log('[LocalShare] Send error: ' + e);
                notify('LocalShare', 'Failed to start. Make sure the server is installed.');
            }
        }

        async _onStopSending() {
            try {
                await httpPost(_internalBase() + '/internal/stop');
            } catch (e) {
                log('[LocalShare] Stop sending error: ' + e);
            }
            this._mode = null;
            this._knownPendingIds = [];
            this._shareUrl = null;
            _stopPolling();
            _disconnectWS();
            this._rebuildMenu();
            notify('LocalShare', 'No longer sending files');
        }

        async _onReceive() {
            try {
                let ok = await ensureBackend();
                if (!ok) {
                    notify('LocalShare', 'Failed to start backend. Is Python 3.12+ installed?');
                    return;
                }

                if (this._mode === 'sending') {
                    await httpPost(_internalBase() + '/internal/stop');
                    this._mode = null;
                    this._knownPendingIds = [];
                }

                await httpPost(_internalBase() + '/internal/start', this._buildStartPayload(null));

                let status = await httpGet(_internalBase() + '/internal/status');
                let ipsData = await httpGet(_internalBase() + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || _settings.get_int('port'));

                notify('LocalShare', 'Receiving files at ' + this._shareUrl);

                this._mode = 'receiving';
                this._rebuildMenu();
                this._refresh();
                _startPolling();
                wsEnabled = true;
                _connectWS();
            } catch (e) {
                log('[LocalShare] Receive error: ' + e);
                notify('LocalShare', 'Failed to start. Make sure the server is installed.');
            }
        }

        async _onStop() {
            try {
                await httpPost(_internalBase() + '/internal/stop');
            } catch (e) {
                log('[LocalShare] Stop error: ' + e);
            }
            this._mode = null;
            this._knownPendingIds = [];
            this._shareUrl = null;
            _stopPolling();
            _disconnectWS();
            this._rebuildMenu();
            notify('LocalShare', 'No longer receiving files');
        }

        async _refresh() {
            if (!this._mode)
                return;

            try {
                let status = await httpGet(_internalBase() + '/internal/status');

                if (!status.sharing_enabled) {
                    this._mode = null;
                    this._knownPendingIds = [];
                    this._shareUrl = null;
                    _stopPolling();
                    _disconnectWS();
                    this._rebuildMenu();
                    return;
                }

                let modeLabel = this._mode === 'sending' ? 'Sending' : 'Receiving';
                let headerText = 'LocalShare \u2014 ' + modeLabel;
                if (status.connected_clients > 0)
                    headerText += ' (' + status.connected_clients + ')';
                this._header.label.text = headerText;
                this._header.label.remove_style_class_name('localshare-status-inactive');
                this._header.label.add_style_class_name('localshare-status-active');

                let ipsData = await httpGet(_internalBase() + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || _settings.get_int('port'));

                this._rebuildMenu();

                let pending = [];
                let connected = [];

                try {
                    let pendingData = await httpGet(_internalBase() + '/internal/pending');
                    pending = pendingData.pending || [];

                    if (pending.length > 0) {
                        this._addDynamicItem(new PopupSeparatorMenuItem());
                    }

                    pending.forEach(client => {
                        if (this._knownPendingIds.indexOf(client.id) === -1) {
                            this._knownPendingIds.push(client.id);
                            notify(
                                'Connection Request',
                                (client.device || 'Unknown') + ' from ' + (client.ip || '') + ' wants to connect'
                            );
                        }

                        let label = (client.device || 'Unknown') + ' (' + (client.ip || '') + ')';

                        let approveItem = new PopupMenuItem('\u2713 ' + label);
                        approveItem.connect('activate', () => this._approveClient(client.id));
                        this._addDynamicItem(approveItem);

                        let rejectItem = new PopupMenuItem('\u2717 ' + label);
                        rejectItem.connect('activate', () => this._rejectClient(client.id));
                        this._addDynamicItem(rejectItem);
                    });
                } catch (e) {
                    log('[LocalShare] Pending error: ' + e);
                }

                try {
                    let clientsData = await httpGet(_internalBase() + '/internal/clients');
                    connected = clientsData.connected || [];

                    if (connected.length > 0) {
                        this._addDynamicItem(new PopupSeparatorMenuItem());
                    }

                    connected.forEach(client => {
                        let label = (client.device || 'Unknown') + ' (' + (client.ip || '') + ')';
                        let item = new PopupMenuItem('  ' + label, { reactive: false });
                        this._addDynamicItem(item);
                    });
                } catch (e) {
                    log('[LocalShare] Clients error: ' + e);
                }

                let activeIds = new Set();
                for (let client of pending)
                    activeIds.add(client.id);
                for (let client of connected)
                    activeIds.add(client.id);
                this._knownPendingIds = this._knownPendingIds.filter(id => activeIds.has(id));
            } catch (e) {
                log('[LocalShare] Refresh error: ' + e);
            }
        }

        async _approveClient(clientId) {
            try {
                await httpPost(_internalBase() + '/internal/approve/' + clientId);
                this._refresh();
            } catch (e) {
                log('[LocalShare] Approve error: ' + e);
            }
        }

        async _rejectClient(clientId) {
            try {
                await httpPost(_internalBase() + '/internal/reject/' + clientId);
                this._refresh();
            } catch (e) {
                log('[LocalShare] Reject error: ' + e);
            }
        }

        _openSettings() {
            try {
                if (_extension)
                    _extension.openPreferences();
            } catch (e) {
                log('[LocalShare] Open prefs error: ' + e);
            }
        }
    }
);
