/* Shared HTTP helpers for LocalShare extension. */

'use strict';

const { GLib, Soup } = imports.gi;

let _httpSession = null;

var getSession = function () {
    if (!_httpSession)
        _httpSession = new Soup.Session({ timeout: 5 });
    return _httpSession;
};

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

        session.send_async(msg, null, (session, result) => {
            try {
                let bytes = session.send_finish(result);
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

var httpGet = function httpGet(url) {
    return httpRequest('GET', url);
};

var httpPost = function httpPost(url, body) {
    return httpRequest('POST', url, body || {});
};

var httpPut = function httpPut(url, body) {
    return httpRequest('PUT', url, body || {});
};
