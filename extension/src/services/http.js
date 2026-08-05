'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

let _httpSession = null;

export function getSession() {
    if (!_httpSession)
        _httpSession = new Soup.Session({ timeout: 5 });
    return _httpSession;
}

function httpRequest(method, url, body) {
    return new Promise((resolve, reject) => {
        let session = getSession();
        let uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
        let msg = new Soup.Message({ method: method, uri: uri });

        if (body !== undefined) {
            let encoder = new TextEncoder();
            let bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            let gbytes = new GLib.Bytes(encoder.encode(bodyStr));
            msg.set_request_body_from_bytes('application/json', gbytes);
        }

        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session_, result) => {
            try {
                let bytes = session_.send_and_read_finish(result);
                if (msg.status_code !== 200) {
                    reject(new Error('HTTP ' + msg.status_code));
                    return;
                }
                let text = new TextDecoder().decode(bytes.toArray());
                resolve(text ? JSON.parse(text) : null);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function httpGet(url) {
    return httpRequest('GET', url);
}

export function httpPost(url, body) {
    return httpRequest('POST', url, body || {});
}

export function httpPut(url, body) {
    return httpRequest('PUT', url, body || {});
}
