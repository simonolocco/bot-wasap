import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const output = path.join(root, 'public', 'admin');
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map(match => match[1]);
const styles = [...html.matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
assert.equal(scripts.length, 1, 'el HTML debe cargar un solo bundle JavaScript inicial');
assert.equal(styles.length, 1, 'el HTML debe cargar una sola hoja de estilos inicial');

function assetBytes(url: string) {
  const file = path.join(output, url.replace(/^\/assets\//, 'assets/'));
  const source = fs.readFileSync(file);
  return { raw: source.length, gzip: zlib.gzipSync(source, { level: 9 }).length };
}

const js = assetBytes(scripts[0]);
const css = assetBytes(styles[0]);
assert.ok(js.gzip <= 75 * 1024, `JavaScript inicial ${js.gzip} bytes supera 75 KB gzip`);
assert.ok(css.gzip <= 20 * 1024, `CSS inicial ${css.gzip} bytes supera 20 KB gzip`);

const sourceCss = fs.readFileSync(path.join(root, 'frontend', 'src', 'styles.css'), 'utf8');
assert.equal(/@import\s+url\(['"]?https?:/i.test(sourceCss), false, 'el CSS no debe depender de fuentes o recursos externos');

const caddy = fs.readFileSync(path.join(root, 'deploy', 'Caddyfile'), 'utf8');
assert.match(caddy, /encode\s+zstd\s+gzip/);
assert.match(caddy, /max-age=31536000, immutable/);

const serviceWorker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
assert.match(serviceWorker, /pathname\.startsWith\('\/api\/'\)/);
assert.doesNotMatch(serviceWorker, /cache\.put\([^\n]*\/api\//);

console.log(`frontend budget: JS ${Math.round(js.gzip / 1024)} KB gzip, CSS ${Math.round(css.gzip / 1024)} KB gzip`);
