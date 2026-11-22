// Precompiles the app so visitors don't download Babel (2.9 MB) and the Tailwind Play
// script and compile everything in their browser. Run after changing public/app.jsx or
// public/tailwind.config.js:   node build.mjs
// Output goes to public/build/ (committed). server.py serves it only while its stamp
// matches the current source; otherwise it falls back to in-browser compilation.
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const require = createRequire(import.meta.url);
const root = path.dirname(new URL(import.meta.url).pathname);
const pub = (...p) => path.join(root, 'public', ...p);
const out = pub('build');
fs.mkdirSync(out, { recursive: true });

// same files, same order as APP_SOURCES in server.py
const sources = ['app.jsx', 'tailwind.config.js'].map((f) => fs.readFileSync(pub(f)));
const hash = createHash('sha256'); sources.forEach((b) => hash.update(b));
const source = hash.digest('hex').slice(0, 16);

// 1. JSX -> JS with the vendored Babel, same preset the browser used
const Babel = require(pub('vendor', 'babel.min.js'));
const js = Babel.transform(sources[0].toString('utf8'), { presets: ['react'], comments: false, compact: true, filename: 'app.jsx' }).code;
fs.writeFileSync(path.join(out, 'app.js'), js);

// 2. Tailwind: the browser config file assigns `tailwind.config = {...}`; run it in a sandbox to read it
const sandbox = { tailwind: {} };
vm.runInNewContext(sources[1].toString('utf8'), sandbox);
const cfgFile = path.join(out, '.tailwind.config.cjs');
fs.writeFileSync(cfgFile, 'module.exports = ' + JSON.stringify({ ...sandbox.tailwind.config, content: [pub('app.jsx'), pub('index.html')] }) + ';\n');
const inFile = path.join(out, '.in.css');
fs.writeFileSync(inFile, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(path.join(root, 'node_modules', '.bin', 'tailwindcss'), ['-c', cfgFile, '-i', inFile, '-o', path.join(out, 'app.css'), '--minify'], { stdio: 'inherit' });
fs.rmSync(cfgFile); fs.rmSync(inFile);

fs.writeFileSync(path.join(out, 'stamp.json'), JSON.stringify({ source }) + '\n');
const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024) + ' KB';
console.log(`built ${source}: app.js ${kb('app.js')}, app.css ${kb('app.css')}`);
