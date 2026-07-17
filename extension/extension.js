'use strict';

const Self = imports.misc.extensionUtils.getCurrentExtension();
imports.searchPath.unshift(Self.dir.get_path());
const main = imports.src.main;

var init = main.init;
var enable = main.enable;
var disable = main.disable;
