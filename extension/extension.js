'use strict';

const Self = imports.misc.extensionUtils.getCurrentExtension();
Self.imports = imports;
imports.searchPath.unshift(Self.dir.get_path());
const main = Self.imports.src.main;

var init = main.init;
var enable = main.enable;
var disable = main.disable;
