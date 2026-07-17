/* LocalShare - Preferences Dialog */

'use strict';

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

const { Gio, GLib, Soup, Gtk, Adw } = imports.gi;

const Self = imports.misc.extensionUtils.getCurrentExtension();
imports.searchPath.unshift(Self.dir.get_path());
const { httpGet, httpPost, httpPut } = imports.services.http;

const INTERNAL_API = 'http://127.0.0.1:8765';

function fillPreferencesWindow(window) {
    window.set_title('LocalShare Settings');
    window.set_default_size(500, 400);

    let page = new Adw.PreferencesPage();

    let fileGroup = new Adw.PreferencesGroup({ title: 'File Locations' });

    let uploadRow = new Adw.EntryRow({ title: 'Upload Directory' });
    fileGroup.add(uploadRow);

    let sharedRow = new Adw.EntryRow({ title: 'Shared Directory' });
    fileGroup.add(sharedRow);

    page.add(fileGroup);

    let netGroup = new Adw.PreferencesGroup({ title: 'Network' });

    let portRow = new Adw.EntryRow({ title: 'Browser Port' });
    netGroup.add(portRow);

    page.add(netGroup);

    let notifyGroup = new Adw.PreferencesGroup({ title: 'Notifications' });

    let uploadNotifyRow = new Adw.SwitchRow({ title: 'Notify on file upload' });
    notifyGroup.add(uploadNotifyRow);

    let downloadNotifyRow = new Adw.SwitchRow({ title: 'Notify on file download' });
    notifyGroup.add(downloadNotifyRow);

    page.add(notifyGroup);

    httpGet(INTERNAL_API + '/internal/config').then(config => {
        uploadRow.set_text(config.upload_dir || '');
        sharedRow.set_text(config.shared_dir || '');
        portRow.set_text(String(config.port || 8080));
        uploadNotifyRow.set_active(config.notify_on_upload !== false);
        downloadNotifyRow.set_active(config.notify_on_download !== false);
    }).catch(e => {
        log('[LocalShare Prefs] Load error: ' + e);
    });

    window.add(page);

    window.connect('close-request', () => {
        let newConfig = {
            upload_dir: uploadRow.get_text(),
            shared_dir: sharedRow.get_text(),
            port: parseInt(portRow.get_text(), 10) || 8080,
            notify_on_upload: uploadNotifyRow.get_active(),
            notify_on_download: downloadNotifyRow.get_active()
        };
        httpPut(INTERNAL_API + '/internal/config', newConfig).catch(e => {
            log('[LocalShare Prefs] Save error: ' + e);
        });
    });
}
