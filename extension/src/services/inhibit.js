'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.SessionManager';
const OBJECT_PATH = '/org/gnome/SessionManager';
const INTERFACE = 'org.gnome.SessionManager';

const APP_ID = 'localshare@rightfix.com';
const INHIBIT_FLAGS = 4 | 8; // Suspend + Idle

let _cookie = 0;
let _pending = false;

export function isInhibited() {
    return _cookie !== 0;
}

export function inhibit(reason) {
    if (_cookie !== 0 || _pending)
        return;
    _pending = true;
    try {
        Gio.DBus.session.call(
            BUS_NAME,
            OBJECT_PATH,
            INTERFACE,
            'Inhibit',
            new GLib.Variant('(susu)', [
                APP_ID,
                0,
                reason || 'File sharing active',
                INHIBIT_FLAGS
            ]),
            new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, result) => {
                _pending = false;
                try {
                    let ret = conn.call_finish(result);
                    _cookie = ret.get_child_value(0).unpack();
                    log('[LocalShare] Inhibit acquired: ' + _cookie);
                } catch (e) {
                    log('[LocalShare] Inhibit failed: ' + e);
                }
            }
        );
    } catch (e) {
        _pending = false;
        log('[LocalShare] Inhibit error: ' + e);
    }
}

export function uninhibit() {
    if (_pending) {
        _pending = false;
    }
    if (_cookie === 0)
        return;
    let cookie = _cookie;
    _cookie = 0;
    try {
        Gio.DBus.session.call(
            BUS_NAME,
            OBJECT_PATH,
            INTERFACE,
            'Uninhibit',
            new GLib.Variant('(u)', [cookie]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, result) => {
                try {
                    conn.call_finish(result);
                    log('[LocalShare] Inhibit released: ' + cookie);
                } catch (e) {
                    log('[LocalShare] Uninhibit failed: ' + e);
                }
            }
        );
    } catch (e) {
        log('[LocalShare] Uninhibit error: ' + e);
    }
}
