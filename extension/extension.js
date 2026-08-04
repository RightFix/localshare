'use strict';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { enable as _enable, disable as _disable } from './src/main.js';

export default class LocalShareExtension extends Extension {
    enable() {
        _enable(this);
    }

    disable() {
        _disable();
    }
}
