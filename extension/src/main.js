/* LocalShare - GNOME Shell Extension */

'use strict';

const { Gio, GLib, GObject, St, Soup, PanelMenu, PopupMenu } = imports.gi;
const Main = imports.ui.main;

const Self = imports.misc.extensionUtils.getCurrentExtension();
Self.imports = imports;
imports.searchPath.unshift(Self.dir.get_path());
const { getSession, httpGet, httpPost, httpPut } = Self.imports.services.http;
const { ensureBackend, stopBackend } = Self.imports.services.backend;

const INTERNAL_API = 'http://127.0.0.1:8765';
const WS_URL = 'ws://127.0.0.1:8765/internal/ws/events';
const POLL_INTERVAL = 3000;
const WS_RECONNECT_DELAY = 3000;

let indicator = null;
let pollTimer = null;
let wsConnection = null;
let wsReconnectId = null;

function notify(title, body) {
    try {
        Main.notify(title, body);
    } catch (e) {
        log('[LocalShare] Notify error: ' + e);
    }
}

function init() {
    log('[LocalShare] Init');
}

function enable() {
    log('[LocalShare] Enable');
    indicator = new LocalShareIndicator();
}

function disable() {
    log('[LocalShare] Disable');
    _stopPolling();
    _disconnectWS();
    if (indicator) {
        indicator._cleanupSendDir();
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
    if (wsConnection)
        return;

    try {
        let session = getSession();
        let uri = GLib.Uri.parse(WS_URL, GLib.UriFlags.NONE);
        let msg = new Soup.Message({ method: 'GET', uri: uri });

        session.websocket_connect_async(msg, null, null, null, (session, result) => {
            try {
                wsConnection = session.websocket_connect_finish(result);
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
    class LocalShareIndicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'LocalShare', false);

            this._mode = null;
            this._shareUrl = null;
            this._sendDir = null;
            this._knownPendingIds = [];

            let icon = new St.Icon({
                icon_name: 'network-server-symbolic',
                style_class: 'system-status-icon'
            });
            this.add_child(icon);

            this._header = new PopupMenu.PopupMenuItem('LocalShare', { reactive: false });
            this.menu.addMenuItem(this._header);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._dynamicSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._dynamicSection);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            let settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => this._openSettings());
            this.menu.addMenuItem(settingsItem);
        }

        _rebuildMenu() {
            this._clearSection(this._dynamicSection);

            if (this._mode === 'sending') {
                let stopItem = new PopupMenu.PopupMenuItem('Stop Sending');
                stopItem.connect('activate', () => this._onStopSending());
                this._dynamicSection.addMenuItem(stopItem);

                let urlItem = new PopupMenu.PopupMenuItem(this._shareUrl || 'URL: unknown', {
                    reactive: false
                });
                this._dynamicSection.addMenuItem(urlItem);
            } else if (this._mode === 'receiving') {
                let stopItem = new PopupMenu.PopupMenuItem('Stop Receiving');
                stopItem.connect('activate', () => this._onStop());
                this._dynamicSection.addMenuItem(stopItem);

                let urlItem = new PopupMenu.PopupMenuItem(this._shareUrl || 'URL: unknown', {
                    reactive: false
                });
                this._dynamicSection.addMenuItem(urlItem);
            } else {
                let sendItem = new PopupMenu.PopupMenuItem('Send');
                sendItem.connect('activate', () => this._onSend());
                this._dynamicSection.addMenuItem(sendItem);

                let recvItem = new PopupMenu.PopupMenuItem('Receive');
                recvItem.connect('activate', () => this._onReceive());
                this._dynamicSection.addMenuItem(recvItem);
            }
        }

        _clearSection(section) {
            let items = section._getMenuItems();
            for (let i = items.length - 1; i >= 0; i--) {
                items[i].destroy();
            }
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
                    this._cleanupSendDir();
                    this._rebuildMenu();
                    break;
                case 'upload_completed':
                    notify('File Received', data.filename + ' from ' + (data.from_device || 'unknown'));
                    break;
                case 'download_completed':
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

        _cleanupSendDir() {
            if (this._sendDir) {
                try {
                    let dir = Gio.File.new_for_path(this._sendDir);
                    dir.delete(null);
                } catch (e) {
                    GLib.spawn_command_line_sync('rm -rf ' + this._sendDir);
                }
                this._sendDir = null;
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
                    await httpPost(INTERNAL_API + '/internal/stop');
                    this._mode = null;
                    this._knownPendingIds = [];
                }

                let files = await new Promise(resolve => {
                    let chooser = new Gtk.FileChooserNative({
                        title: 'Select files to send',
                        action: Gtk.FileChooserAction.OPEN,
                        select_multiple: true,
                        modal: true
                    });

                    chooser.connect('response', (widget, response) => {
                        if (response === Gtk.ResponseType.ACCEPT) {
                            resolve(chooser.get_files());
                        } else {
                            resolve(null);
                        }
                        chooser.destroy();
                    });

                    chooser.show();
                });

                if (!files || files.length === 0)
                    return;

                let tmpBase = GLib.get_tmp_dir();
                let sendDir = GLib.mkdtemp(tmpBase + '/localshare-send-XXXXXX');

                for (let i = 0; i < files.length; i++) {
                    let file = files.nth_data(i);
                    let sourcePath = file.get_path();
                    let linkName = file.get_basename();
                    let linkPath = sendDir + '/' + linkName;

                    try {
                        let linkFile = Gio.File.new_for_path(linkPath);
                        linkFile.make_symbolic_link(sourcePath, null);
                    } catch (e) {
                        log('[LocalShare] Symlink error for ' + linkName + ': ' + e);
                    }
                }

                this._sendDir = sendDir;

                await httpPost(INTERNAL_API + '/internal/start', {
                    port: 8080,
                    internal_port: 8765,
                    shared_dir: sendDir
                });

                let status = await httpGet(INTERNAL_API + '/internal/status');
                let ipsData = await httpGet(INTERNAL_API + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || 8080);

                notify('LocalShare', 'Sending files at ' + this._shareUrl);

                this._mode = 'sending';
                this._rebuildMenu();
                this._refresh();
                _startPolling();
                _connectWS();
            } catch (e) {
                log('[LocalShare] Send error: ' + e);
                notify('LocalShare', 'Failed to start. Make sure the server is installed.');
            }
        }

        async _onStopSending() {
            this._cleanupSendDir();
            try {
                await httpPost(INTERNAL_API + '/internal/stop');
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
                    this._cleanupSendDir();
                    await httpPost(INTERNAL_API + '/internal/stop');
                    this._mode = null;
                    this._knownPendingIds = [];
                }

                await httpPost(INTERNAL_API + '/internal/start', {
                    port: 8080,
                    internal_port: 8765
                });

                let status = await httpGet(INTERNAL_API + '/internal/status');
                let ipsData = await httpGet(INTERNAL_API + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || 8080);

                notify('LocalShare', 'Receiving files at ' + this._shareUrl);

                this._mode = 'receiving';
                this._rebuildMenu();
                this._refresh();
                _startPolling();
                _connectWS();
            } catch (e) {
                log('[LocalShare] Receive error: ' + e);
                notify('LocalShare', 'Failed to start. Make sure the server is installed.');
            }
        }

        async _onStop() {
            try {
                await httpPost(INTERNAL_API + '/internal/stop');
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
                let status = await httpGet(INTERNAL_API + '/internal/status');

                if (!status.sharing_enabled) {
                    this._mode = null;
                    this._knownPendingIds = [];
                    this._shareUrl = null;
                    this._cleanupSendDir();
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

                let ipsData = await httpGet(INTERNAL_API + '/internal/ips');
                let ips = ipsData.ips || [];
                let ip = ips.length > 0 ? ips[0] : 'localhost';
                this._shareUrl = 'http://' + ip + ':' + (status.port || 8080);

                this._rebuildMenu();

                try {
                    let pendingData = await httpGet(INTERNAL_API + '/internal/pending');
                    let pending = pendingData.pending || [];

                    if (pending.length > 0) {
                        this._dynamicSection.addMenuItem(
                            new PopupMenu.PopupSeparatorMenuItem()
                        );
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

                        let approveItem = new PopupMenu.PopupMenuItem('\u2713 ' + label);
                        approveItem.connect('activate', () => this._approveClient(client.id));
                        this._dynamicSection.addMenuItem(approveItem);

                        let rejectItem = new PopupMenu.PopupMenuItem('\u2717 ' + label);
                        rejectItem.connect('activate', () => this._rejectClient(client.id));
                        this._dynamicSection.addMenuItem(rejectItem);
                    });
                } catch (e) {
                    log('[LocalShare] Pending error: ' + e);
                }

                try {
                    let clientsData = await httpGet(INTERNAL_API + '/internal/clients');
                    let connected = clientsData.connected || [];

                    if (connected.length > 0) {
                        this._dynamicSection.addMenuItem(
                            new PopupMenu.PopupSeparatorMenuItem()
                        );
                    }

                    connected.forEach(client => {
                        let label = (client.device || 'Unknown') + ' (' + (client.ip || '') + ')';
                        let item = new PopupMenu.PopupMenuItem('  ' + label, { reactive: false });
                        this._dynamicSection.addMenuItem(item);
                    });
                } catch (e) {
                    log('[LocalShare] Clients error: ' + e);
                }
            } catch (e) {
                log('[LocalShare] Refresh error: ' + e);
            }
        }

        async _approveClient(clientId) {
            try {
                await httpPost(INTERNAL_API + '/internal/approve/' + clientId);
                this._refresh();
            } catch (e) {
                log('[LocalShare] Approve error: ' + e);
            }
        }

        async _rejectClient(clientId) {
            try {
                await httpPost(INTERNAL_API + '/internal/reject/' + clientId);
                this._refresh();
            } catch (e) {
                log('[LocalShare] Reject error: ' + e);
            }
        }

        _openSettings() {
            let win = new LocalShareSettingsWindow();
            win._show();
        }
    }
);

var LocalShareSettingsWindow = class {
    constructor() {
        this._window = null;
    }

    async _show() {
        let Gtk = imports.gi.Gtk;
        let Adw = imports.gi.Adw;

        let config;
        try {
            config = await httpGet(INTERNAL_API + '/internal/config');
        } catch (e) {
            notify('LocalShare', 'Could not load settings. Is the backend running?');
            return;
        }

        let pathEntry = new Adw.EntryRow({
            title: 'Receive Path'
        });
        pathEntry.set_text(config.upload_dir || '');
        pathEntry.set_editable(false);

        let browseBtn = new Gtk.Button({ label: 'Browse' });
        browseBtn.add_css_class('flat');
        browseBtn.connect('clicked', () => {
            let chooser = new Gtk.FileChooserNative({
                title: 'Select Receiving Folder',
                action: Gtk.FileChooserAction.SELECT_FOLDER,
                modal: true
            });

            let currentPath = pathEntry.get_text();
            if (currentPath) {
                try {
                    let file = Gio.File.new_for_path(currentPath);
                    if (file.query_exists(null))
                        chooser.set_file(file);
                } catch (e) {}
            }

            chooser.connect('response', (widget, response) => {
                if (response === Gtk.ResponseType.ACCEPT) {
                    let folder = chooser.get_file();
                    if (folder)
                        pathEntry.set_text(folder.get_path());
                }
                chooser.destroy();
            });

            chooser.show();
        });
        pathEntry.add_suffix(browseBtn);

        let group = new Adw.PreferencesGroup();
        group.add(pathEntry);

        let page = new Adw.PreferencesPage();
        page.add(group);

        let saveBtn = new Gtk.Button({ label: 'Save', halign: Gtk.Align.END });
        saveBtn.add_css_class('suggested-action');
        saveBtn.connect('clicked', async () => {
            let newPath = pathEntry.get_text().trim();
            if (!newPath)
                return;

            saveBtn.sensitive = false;
            saveBtn.label = 'Saving...';

            try {
                await httpPut(INTERNAL_API + '/internal/config', {
                    upload_dir: newPath
                });
                notify('LocalShare', 'Receive path saved');
                win.close();
            } catch (e) {
                log('[LocalShare] Settings save error: ' + e);
                notify('LocalShare', 'Failed to save settings');
                saveBtn.sensitive = true;
                saveBtn.label = 'Save';
            }
        });

        let toolbar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
            hexpand: true
        });
        toolbar.append(saveBtn);

        let hdr = new Adw.HeaderBar();

        let content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        content.append(hdr);
        content.append(page);
        content.append(toolbar);

        let win = new Adw.Window({
            title: 'LocalShare Settings',
            default_width: 450,
            default_height: 250,
            modal: true
        });
        win.set_content(content);
        win.present();
        this._window = win;
    }

    destroy() {
        if (this._window) {
            this._window.close();
            this._window = null;
        }
    }
};
