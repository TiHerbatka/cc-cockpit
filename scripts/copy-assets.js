// Copies xterm's browser assets into public/vendor so the page can load them
// without a CDN or bundler. Resolves package locations via require.resolve so
// it survives version path changes.
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public', 'vendor');
fs.mkdirSync(outDir, { recursive: true });

// @xterm/xterm main entry is its UMD lib build (.../lib/xterm.js).
const xtermMain = require.resolve('@xterm/xterm');
const xtermRoot = path.resolve(path.dirname(xtermMain), '..'); // package root
const fitMain = require.resolve('@xterm/addon-fit'); // .../lib/addon-fit.js

const copies = [
  [xtermMain, 'xterm.js'],
  [path.join(xtermRoot, 'css', 'xterm.css'), 'xterm.css'],
  [fitMain, 'addon-fit.js'],
];

for (const [src, name] of copies) {
  fs.copyFileSync(src, path.join(outDir, name));
  console.log('vendored', name);
}
