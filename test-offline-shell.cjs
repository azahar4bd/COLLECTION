/* Offline app-shell packaging checks (no network required). */
const fs = require('fs');
const assert = require('assert');
const sw = fs.readFileSync('sw.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
const results = [];
const check = (name, fn) => { try { fn(); results.push('✅ ' + name); } catch (e) { results.push('❌ ' + name + ' → ' + e.message); process.exitCode = 1; } };
check('Service worker syntax ও versioned shell আছে', () => {
  new Function(sw);
  const version = app.match(/APP_VER\s*=\s*'([^']+)'/)?.[1];
  assert(version, 'APP_VER পাওয়া যায়নি');
  assert(sw.includes(`collection-shell-${version}`));
  assert(html.includes(`app.js?v=${version.replace(/^v/, '')}`));
});
check('Shell-এর প্রতিটি local asset workspace-এ আছে', () => {
  for (const file of ['index.html', 'styles.css', 'app.js', 'shared/csv-rules.js', 'shared/xls-reader.js', 'manifest.webmanifest']) assert(fs.existsSync(file), file);
});
check('Navigation offline fallback ও cache cleanup আছে', () => { assert(sw.includes("request.mode === 'navigate'")); assert(sw.includes("caches.match('/index.html')")); assert(sw.includes('caches.delete')); });
check('API cache হিসেবে offline data source নয়', () => { assert(sw.includes("url.pathname.startsWith('/api/')")); assert(sw.indexOf("url.pathname.startsWith('/api/')") < sw.indexOf("request.mode === 'navigate'")); });
check('App service worker register করে', () => { assert(app.includes("navigator.serviceWorker.register('/sw.js')")); });
check('Manifest standalone app হিসেবে যুক্ত', () => { assert.strictEqual(manifest.display, 'standalone'); assert(html.includes('rel="manifest"')); });
check('Offline outbox persistent key ও reconnect handler আছে', () => { assert(app.includes('collectionManager.offlineOutbox.v1')); assert(app.includes("window.addEventListener('online'")); assert(app.includes('flushOutbox')); });
console.log(results.join('\n'));
const failed = results.filter((line) => line.startsWith('❌')).length;
console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
process.exit(failed ? 1 : 0);
