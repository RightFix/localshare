'use strict';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { httpPut } from './src/services/http.js';

const CONFIG_KEYS = [
    'upload-dir',
    'shared-dir',
    'port',
    'internal-port',
    'notify-on-upload',
    'notify-on-download'
];

function _buildConfigPayload(settings) {
    let payload = {
        port: settings.get_int('port'),
        internal_port: settings.get_int('internal-port'),
        notify_on_upload: settings.get_boolean('notify-on-upload'),
        notify_on_download: settings.get_boolean('notify-on-download')
    };
    let uploadDir = settings.get_string('upload-dir');
    let sharedDir = settings.get_string('shared-dir');
    if (uploadDir)
        payload.upload_dir = uploadDir;
    if (sharedDir)
        payload.shared_dir = sharedDir;
    return payload;
}

export default class LocalSharePreferences extends ExtensionPreferences {
    _browse(row, action, parent) {
        let chooser = new Gtk.FileChooserNative({
            title: _('Select folder'),
            action: action,
            modal: true,
            transient_for: parent
        });

        let current = row.get_text();
        if (current) {
            try {
                let file = Gio.File.new_for_path(current);
                if (file.query_exists(null))
                    chooser.set_file(file);
            } catch (e) {}
        }

        chooser.connect('response', (widget, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                let file = chooser.get_file();
                if (file)
                    row.set_text(file.get_path());
            }
            chooser.destroy();
        });

        chooser.show();
    }

    _makeFolderRow(title, settings, key, parent) {
        let row = new Adw.EntryRow({ title: _(title) });
        row.set_text(settings.get_string(key) || '');
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);

        let browseBtn = new Gtk.Button({ label: _('Browse'), valign: Gtk.Align.CENTER });
        browseBtn.add_css_class('flat');
        browseBtn.connect('clicked', () =>
            this._browse(row, Gtk.FileChooserAction.SELECT_FOLDER, parent));
        row.add_suffix(browseBtn);

        return row;
    }

    _makePortRow(title, settings, key) {
        let row = new Adw.SpinRow({
            title: _(title),
            adjustment: new Gtk.Adjustment({
                lower: 1024,
                upper: 65535,
                step_increment: 1,
                value: settings.get_int(key)
            })
        });
        row.set_update_policy(Gtk.SpinButtonUpdatePolicy.IF_VALID);
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    fillPreferencesWindow(window) {
        window.set_title('LocalShare Settings');
        window.set_default_size(500, 400);

        const settings = this.getSettings();

        let page = new Adw.PreferencesPage();

        let fileGroup = new Adw.PreferencesGroup({ title: _('File Locations') });

        fileGroup.add(this._makeFolderRow('Upload Directory', settings, 'upload-dir', window));
        fileGroup.add(this._makeFolderRow('Shared Directory', settings, 'shared-dir', window));

        page.add(fileGroup);

        let netGroup = new Adw.PreferencesGroup({ title: _('Network') });

        netGroup.add(this._makePortRow('Browser Port', settings, 'port'));
        netGroup.add(this._makePortRow('Internal API Port', settings, 'internal-port'));

        page.add(netGroup);

        let notifyGroup = new Adw.PreferencesGroup({ title: _('Notifications') });

        let uploadNotifyRow = new Adw.SwitchRow({ title: _('Notify on file upload') });
        settings.bind('notify-on-upload', uploadNotifyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifyGroup.add(uploadNotifyRow);

        let downloadNotifyRow = new Adw.SwitchRow({ title: _('Notify on file download') });
        settings.bind('notify-on-download', downloadNotifyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifyGroup.add(downloadNotifyRow);

        let autoStartRow = new Adw.SwitchRow({ title: _('Auto-start sharing') });
        settings.bind('auto-start', autoStartRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifyGroup.add(autoStartRow);

        page.add(notifyGroup);

        window.add(page);

        let backendBase = 'http://127.0.0.1:' + settings.get_int('internal-port');
        CONFIG_KEYS.forEach(key => {
            settings.connect('changed::' + key, () => {
                httpPut(backendBase + '/internal/config', _buildConfigPayload(settings)).catch(() => {});
            });
        });
    }
}
