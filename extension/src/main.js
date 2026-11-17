'use strict';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Soup from 'gi://Soup';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Button as PanelMenuButton } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {
    PopupBaseMenuItem,
    PopupMenuItem,
    PopupMenuSection,
    PopupSeparatorMenuItem
} from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { getSession, httpGet, httpPost, httpPut } from './services/http.js';
import { init as initBackend, ensureBackend, stopBackend } from './services/backend.js';
import { inhibit as _inhibitSharing, uninhibit as _uninhibitSharing } from './services/inhibit.js';

const WS_RECONNECT_DELAY = 3000;
const POLL_INTERVAL = 3000;

let _extension = null;
let _settings = null;
let indicator = null;
let pollTimer = null;
let wsConnection = null;
let wsReconnectId = null;
let wsEnabled = false;
let wsMessageId = 0;
let wsClosedId = 0;
let inhibitSettingId = 0;

function _shouldInhibit() {
    try {
        return _settings && _settings.get_boolean('inhibit-suspend');
    } catch (e) {
        return true;
    }
}

function _applyInhibit() {
    if (_shouldInhibit())
        _inhibitSharing('LocalShare file sharing active');
    else
        _uninhibitSharing();
}

function _releaseInhibit() {
    _uninhibitSharing();
}

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
    Main.panel.addToStatusArea('localshare', indicator, 0, 'right');

    if (inhibitSettingId === 0) {
        try {
            inhibitSettingId = _settings.connect('changed::inhibit-suspend', () => {
                if (indicator && indicator._mode) {
                    if (_shouldInhibit())
                        _inhibitSharing('LocalShare file sharing active');
                    else
                        _releaseInhibit();
                } else {
                    _releaseInhibit();
                }
            });
        } catch (e) {
            log('[LocalShare] Inhibit setting signal error: ' + e);
        }
    }

    if (_settings.get_boolean('auto-start'))
        indicator._autoStart();
}

export function disable() {
    log('[LocalShare] Disable');
    _stopPolling();
    _disconnectWS();
    _releaseInhibit();
    if (inhibitSettingId !== 0 && _settings) {
        try {
            _settings.disconnect(inhibitSettingId);
        } catch (e) {
            log('[LocalShare] Signal disconnect error: ' + e);
        }
        inhibitSettingId = 0;
    }
    if (indicator) {
        for (let s of indicator._staticSignals) {
            try {
                s.obj.disconnect(s.id);
            } catch (e) {
                log('[LocalShare] Signal disconnect error: ' + e);
            }
        }
        indicator._staticSignals = [];
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

        session.websocket_connect_async(msg, null, null, GLib.PRIORITY_DEFAULT, null, (session_, result) => {
            try {
                wsConnection = session_.websocket_connect_finish(result);
                log('[LocalShare] WS connected');

                if (!wsEnabled) {
                    try {
                        wsConnection.close(1000, 'disabled');
                    } catch (e) {}
                    wsConnection = null;
                    return;
                }

                wsMessageId = wsConnection.connect('message', (conn, type, data) => {
                    try {
                        let text = new TextDecoder().decode(data.get_data());
                        let msg = JSON.parse(text);
                        if (indicator)
                            indicator._handleWSEvent(msg.event, msg.data);
                    } catch (e) {
                        log('[LocalShare] WS msg error: ' + e);
                    }
                });

                wsClosedId = wsConnection.connect('closed', () => {
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
        if (wsMessageId) {
            try {
                wsConnection.disconnect(wsMessageId);
            } catch (e) {
                log('[LocalShare] WS message disconnect error: ' + e);
            }
            wsMessageId = 0;
        }
        if (wsClosedId) {
            try {
                wsConnection.disconnect(wsClosedId);
            } catch (e) {
                log('[LocalShare] WS closed disconnect error: ' + e);
            }
            wsClosedId = 0;
        }
        try {
            wsConnection.close(1000, 'Extension disabled');
        } catch (e) {
            log('[LocalShare] WS close error: ' + e);
        }
        wsConnection = null;
    }
}

let LocalShareIndicator = GObject.registerClass(
    class LocalShareIndicator extends PanelMenuButton {
        _init() {
            super._init(0.0, 'LocalShare', false);

            this._mode = null;
            this._shareUrl = null;
            this._knownPendingIds = [];
            this._pendingNotifications = {};
            this._dynamicItems = [];
            this._dynamicSignals = [];
            this._staticSignals = [];

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

            this._textItem = this._buildTextItem();
            this.menu.addMenuItem(this._textItem);

            let settingsItem = new PopupMenuItem('Settings');
            this._connectActivate(settingsItem, () => this._openSettings(), false);
            this.menu.addMenuItem(settingsItem);

            this._rebuildMenu();
        }

        _buildTextItem() {
            let item = new PopupBaseMenuItem({ reactive: true, activate: false });

            this._textEntry = new St.Entry({
                hint_text: 'Send text\u2026',
                style_class: 'localshare-text-entry',
                can_focus: true
            });
            let clutterText = this._textEntry.clutter_text;
            clutterText.single_line_mode = false;
            clutterText.line_wrap = true;
            clutterText.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            clutterText.connect('text-changed', () => {
                this._resizeTextEntry();
            });
            clutterText.connect('key-press-event', (actor, event) => {
                const symbol = event.get_key_symbol();
                if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                    const state = event.get_state();
                    if ((state & Clutter.ModifierType.SHIFT_MASK) === 0) {
                        this._sendTextEntry();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
            item.add_child(this._textEntry);

            let sendButton = new St.Button({
                label: 'Send',
                style_class: 'localshare-text-send',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER
            });
            sendButton.connect('clicked', () => {
                this._sendTextEntry();
            });
            item.add_child(sendButton);

            item.visible = true;
            return item;
        }

        _resizeTextEntry() {
            if (!this._textEntry)
                return;

            // The entry has a fixed width (see stylesheet), so measure how
            // tall the wrapped text needs to be and grow up to a limit.
            const width = this._textEntry.width > 0 ? this._textEntry.width : 140;
            const textWidth = Math.max(40, width - 16);
            const [, natural] = this._textEntry.clutter_text.get_preferred_height(textWidth);

            const text = this._textEntry.get_text();
            const charsPerLine = Math.max(8, Math.floor(textWidth / 7));
            let lines = 0;
            for (const line of text.split('\n'))
                lines += Math.max(1, Math.ceil(line.length / charsPerLine));
            const estimated = lines * 18;

            const height = Math.min(180,
                Math.max(30, Math.max(Math.ceil(natural), estimated) + 12));
            this._textEntry.set_style(`min-height: ${height}px;`);
        }

        async _sendTextEntry() {
            let text = this._textEntry.get_text();
            if (!text || text.trim().length === 0) {
                notify('LocalShare', 'Nothing to send.');
                return;
            }
            try {
                if (!this._mode) {
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
                    _startPolling();
                    wsEnabled = true;
                    _connectWS();
                    _applyInhibit();
                    this._rebuildMenu();
                    this._refresh();
                }
                await httpPost(_internalBase() + '/internal/send-text', { text: text });
                this._textEntry.set_text('');
                notify('LocalShare', 'Text sent to connected devices.');
            } catch (e) {
                log('[LocalShare] Send text error: ' + e);
                notify('LocalShare', 'Failed to send text.');
            }
        }

        _addDynamicItem(item) {
            this._dynamicSection.addMenuItem(item);
            this._dynamicItems.push(item);
        }

        _connectActivate(item, callback, dynamic = true) {
            let id = item.connect('activate', callback);
            (dynamic ? this._dynamicSignals : this._staticSignals).push({ obj: item, id });
            return id;
        }

        _rebuildMenu() {
            this._clearSection();
            this._dynamicItems = [];

            if (this._mode === 'sending') {
                let stopItem = new PopupMenuItem('Stop Sending');
                this._connectActivate(stopItem, () => this._onStopSending());
                this._addDynamicItem(stopItem);

                let urlItem = new PopupMenuItem(this._shareUrl || 'URL: unknown', {
                    reactive: false
                });
                this._addDynamicItem(urlItem);
            } else if (this._mode === 'receiving') {
                let stopItem = new PopupMenuItem('Stop Receiving');
                this._connectActivate(stopItem, () => this._onStop());
                this._addDynamicItem(stopItem);

                let urlItem = new PopupMenuItem(this._shareUrl || 'URL: unknown', {
                    reactive: false
                });
                this._addDynamicItem(urlItem);
            } else {
                let sendItem = new PopupMenuItem('Send');
                this._connectActivate(sendItem, () => this._onSend());
                this._addDynamicItem(sendItem);

                let recvItem = new PopupMenuItem('Receive');
                this._connectActivate(recvItem, () => this._onReceive());
                this._addDynamicItem(recvItem);
            }
        }

        _clearSection() {
            for (let s of this._dynamicSignals) {
                try {
                    s.obj.disconnect(s.id);
                } catch (e) {
                    log('[LocalShare] Signal disconnect error: ' + e);
                }
            }
            this._dynamicSignals = [];
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
                    if (data.client_id)
                        this._removePendingNotification(data.client_id);
                    this._refresh();
                    break;
                case 'sharing_stopped':
                    this._clearPendingNotifications();
                    notify('Sharing Stopped', 'File sharing has been disabled');
                    this._mode = null;
                    _releaseInhibit();
                    this._rebuildMenu();
                    break;
                case 'upload_completed':
                    if (_settings.get_boolean('notify-on-upload')) {
                        let body = data.filename + ' from ' + (data.from_device || 'unknown');
                        if (data.text)
                            body = data.text;
                        notify('File Received', body);
                    }
                    break;
                case 'download_completed':
                    if (_settings.get_boolean('notify-on-download')) {
                        let body = data.filename + ' by ' + (data.to_device || 'unknown');
                        if (data.text)
                            body = data.text;
                        notify('File Downloaded', body);
                    }
                    break;
                default:
                    break;
            }
        }

        _removePendingNotification(clientId) {
            let notification = this._pendingNotifications[clientId];
            if (!notification)
                return;
            try {
                notification.destroy();
            } catch (e) {
                log('[LocalShare] Notification destroy error: ' + e);
            }
            delete this._pendingNotifications[clientId];
        }

        _clearPendingNotifications() {
            for (let clientId of Object.keys(this._pendingNotifications)) {
                try {
                    this._pendingNotifications[clientId].destroy();
                } catch (e) {
                    log('[LocalShare] Notification destroy error: ' + e);
                }
            }
            this._pendingNotifications = {};
        }

        _addPendingClient(data) {
            if (this._knownPendingIds.indexOf(data.client_id) !== -1)
                return;
            this._knownPendingIds.push(data.client_id);

            try {
                let body = (data.device || 'Unknown') + ' from ' + (data.ip || 'Unknown') + ' wants to connect';
                let notification = new MessageTray.Notification({
                    source: MessageTray.getSystemSource(),
                    title: 'Connection Request',
                    body: body,
                    isTransient: false,
                    resident: true,
                    urgency: MessageTray.Urgency.CRITICAL
                });

                notification.addAction('Accept', () => {
                    this._removePendingNotification(data.client_id);
                    this._approveClient(data.client_id);
                });

                notification.addAction('Decline', () => {
                    this._removePendingNotification(data.client_id);
                    this._rejectClient(data.client_id);
                });

                this._pendingNotifications[data.client_id] = notification;
                MessageTray.getSystemSource().addNotification(notification);
            } catch (e) {
                log('[LocalShare] Notification error: ' + e);
            }
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
                let resolved = false;
                let unsubId = 0;

                const finish = files => {
                    if (resolved)
                        return;
                    resolved = true;
                    if (unsubId)
                        Gio.DBus.session.signal_unsubscribe(unsubId);
                    resolve(files);
                };

                try {
                    Gio.DBus.session.call(
                        'org.freedesktop.portal.Desktop',
                        '/org/freedesktop/portal/desktop',
                        'org.freedesktop.portal.FileChooser',
                        'OpenFile',
                        new GLib.Variant('(ssa{sv})', ['', 'Select files to send', {
                            multiple: new GLib.Variant('b', true),
                            modal: new GLib.Variant('b', true)
                        }]),
                        GLib.VariantType.new('(o)'),
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (conn, result) => {
                            try {
                                let ret = conn.call_finish(result);
                                let handle = ret.get_child_value(0).unpack();

                                unsubId = conn.signal_subscribe(
                                    'org.freedesktop.portal.Desktop',
                                    'org.freedesktop.portal.Request',
                                    'Response',
                                    handle,
                                    null,
                                    Gio.DBusSignalFlags.NONE,
                                    (c, sender, path, iface, signal, params) => {
                                        try {
                                            let response = params.get_child_value(0).unpack();
                                            if (response !== 0) {
                                                finish(null);
                                                return;
                                            }
                                            let results = params.get_child_value(1);
                                            let urisVar = results.lookup_value('uris', null);
                                            if (!urisVar) {
                                                finish(null);
                                                return;
                                            }
                                            let uris = urisVar.deep_unpack();
                                            let files = [];
                                            for (let i = 0; i < uris.length; i++)
                                                files.push(Gio.File.new_for_uri(uris[i]));
                                            finish(files);
                                        } catch (e) {
                                            log('[LocalShare] Portal response error: ' + e);
                                            finish(null);
                                        }
                                    }
                                );
                            } catch (e) {
                                log('[LocalShare] Portal open error: ' + e);
                                finish(null);
                            }
                        }
                    );
                } catch (e) {
                    log('[LocalShare] Portal error: ' + e);
                    finish(null);
                }
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
                _applyInhibit();
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
                    this._clearPendingNotifications();
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
                _applyInhibit();
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
            this._clearPendingNotifications();
            this._shareUrl = null;
            _stopPolling();
            _disconnectWS();
            _releaseInhibit();
            this._rebuildMenu();
            notify('LocalShare', 'No longer sending files');
        }

        async _onReceive() {
            try {
                let ok = await ensureBackend();
                if (!ok) {
                    notify('LocalShare', 'Failed to start backend.');
                    return;
                }

                if (this._mode === 'sending') {
                    await httpPost(_internalBase() + '/internal/stop');
                    this._mode = null;
                    this._knownPendingIds = [];
                    this._clearPendingNotifications();
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
                _applyInhibit();
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
            this._clearPendingNotifications();
            this._shareUrl = null;
            _stopPolling();
            _disconnectWS();
            _releaseInhibit();
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
                    this._clearPendingNotifications();
                    this._shareUrl = null;
                    _stopPolling();
                    _disconnectWS();
                    _releaseInhibit();
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
                            this._addPendingClient({
                                client_id: client.id,
                                device: client.device,
                                ip: client.ip
                            });
                        }

                        let label = (client.device || 'Unknown') + ' (' + (client.ip || '') + ')';

                        let approveItem = new PopupMenuItem('\u2713 ' + label);
                        this._connectActivate(approveItem, () => this._approveClient(client.id));
                        this._addDynamicItem(approveItem);

                        let rejectItem = new PopupMenuItem('\u2717 ' + label);
                        this._connectActivate(rejectItem, () => this._rejectClient(client.id));
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
                for (let clientId of Object.keys(this._pendingNotifications)) {
                    if (!activeIds.has(clientId))
                        this._removePendingNotification(clientId);
                }
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
