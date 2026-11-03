/* Same-Staff two-device reconnect: pending entries must survive canonical refresh races. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const mergeSource = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8')
  .replace('export function applyPatch', 'function applyPatch')
  .replace(/export \{[^}]+\};?\s*$/, '') + '\nmodule.exports = { applyPatch };';
const mergeModule = { exports: {} };
new Function('module', 'exports', mergeSource)(mergeModule, mergeModule.exports);
const { applyPatch } = mergeModule.exports;

const clone = (value) => JSON.parse(JSON.stringify(value));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const appSource = fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__flush = flushOutbox;
window.__load = loadDB;
window.__showGate = showIdentityGate;
window.__selectIdentity = selectIdentity;
`;
const html = fs.readFileSync('index.html', 'utf8');

function initialRemote() {
  return {
    headers: ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'],
    rows: [
      ['0001', 'Alice One', '001', 'Alice', '100', '0'],
      ['0003', 'Alice Two', '003', 'Alice', '100', '0'],
    ],
    collections: [], followups: [], history: [], updated_at: '2026-11-03T00:00:00.000Z',
    dailyData: {
      memberDBHeaders: ['Member No', 'Member Name', 'Center Code & Name'],
      memberDB: [['0001', 'Alice One', '001, One'], ['0003', 'Alice Two', '003, Three']],
      balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [], staffDirectory: [],
    },
  };
}

function makeEnvironment() {
  const remote = { current: initialRemote() };
  let tick = 0;
  const commit = (patch) => {
    remote.current = applyPatch(remote.current, patch);
    remote.current.updated_at = new Date(Date.UTC(2026, 10, 3, 0, 0, ++tick)).toISOString();
  };
  const devices = [];
  const createDevice = async (name, storageSnapshot = null) => {
    const w = new JSDOM(html, {
      url: `https://${name}.invalid`, runScripts: 'outside-only', pretendToBeVisual: true,
    }).window;
    if (storageSnapshot) Object.entries(storageSnapshot).forEach(([key, value]) => w.localStorage.setItem(key, value));
    const device = { name, w, netAvailable: true, holdGet: false, heldGets: [] };
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    w.confirm = () => true;
    w.fetch = async (url, options = {}) => {
      if (!device.netAvailable) throw new Error(`${name}: simulated offline network`);
      const method = options.method || 'GET';
      if (method === 'POST') {
        commit(clone(JSON.parse(options.body).patch));
        return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.current.updated_at }) };
      }
      if (method === 'PUT') {
        remote.current = clone(JSON.parse(options.body));
        remote.current.updated_at = new Date(Date.UTC(2026, 10, 3, 0, 0, ++tick)).toISOString();
        return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.current.updated_at }) };
      }
      if (String(url).includes('meta=1')) {
        return { ok: true, status: 200, json: async () => ({ updated_at: remote.current.updated_at, counts: {} }) };
      }
      const snapshot = clone(remote.current);
      if (device.holdGet) {
        return new Promise((resolve) => {
          device.heldGets.push(() => resolve({ ok: true, status: 200, json: async () => clone(snapshot) }));
        });
      }
      return { ok: true, status: 200, json: async () => clone(snapshot) };
    };
    w.eval(appSource);
    device.state = w.__state;
    devices.push(device);
    await waitFor(() => device.state.rows.length === 2 && device.state.savedDoc, `${name} initial load`);
    w.__showGate();
    const select = w.document.querySelector('#identity-select');
    const alice = [...select.options].find((option) => option.value.startsWith('staff|') && option.value.includes('Alice'));
    assert(alice, `${name}: same Staff identity is unavailable`);
    select.value = alice.value;
    w.__selectIdentity();
    return device;
  };
  const add = async (device, code, name, loan) => {
    const $ = (selector) => device.w.document.querySelector(selector);
    $('#today-member-code').value = code;
    $('#today-member-name').value = name;
    $('#today-loan').value = String(loan);
    $('#today-savings').value = '0';
    $('#today-dps').value = '0';
    $('#today-total').value = '';
    await device.w.__add();
    assert.strictEqual(device.state.todayRows[0].memberCode, code, `${name}: local entry was not created`);
    return String(device.state.todayRows[0].id);
  };
  return { remote, createDevice, add, devices };
}

async function waitFor(predicate, label, timeout = 2500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timeout waiting for ${label}`);
    await wait(5);
  }
}
const todayIds = (document) => (document.dailyData?.todayRows || []).map((item) => String(item.id));

async function offlineReconnectStaleGetScenario() {
  const env = makeEnvironment();
  const a = await env.createDevice('device-a');
  const b = await env.createDevice('device-b');

  /* A canonical request was already in flight when this device went offline. */
  a.holdGet = true;
  const staleLoading = a.w.__load(true);
  await waitFor(() => a.heldGets.length === 1, 'pre-offline canonical GET');
  a.netAvailable = false;
  a.state.isOnline = false;
  const offlineId = await env.add(a, '0001', 'Alice One', 40);
  await wait(60);
  assert.strictEqual(a.state.outbox.length, 1, 'offline operation was not queued');

  const otherId = await env.add(b, '0003', 'Alice Two', 60);
  await b.w.__flush();
  assert(todayIds(env.remote.current).includes(otherId), 'second device did not sync');

  /* Reconnect flushes the offline entry before the old GET response arrives. */
  a.netAvailable = true;
  a.state.isOnline = true;
  await a.w.__flush();
  assert.strictEqual(a.state.outbox.length, 0, 'reconnect did not flush the offline operation');
  assert(todayIds(env.remote.current).includes(offlineId), 'offline entry never reached the server');
  a.holdGet = false;
  a.heldGets.shift()();
  await staleLoading;

  assert(a.state.todayRows.some((item) => String(item.id) === offlineId), 'stale canonical response erased the reconnected device entry');
  assert.strictEqual(a.state.rows[0][5], '40', 'stale canonical response rolled back the installment actual delta');
  assert.strictEqual(env.remote.current.rows[0][5], '40', 'server installment delta is incorrect');
  const cached = JSON.parse(a.w.localStorage.getItem('collectionManager.fullDoc.v1'));
  assert(todayIds(cached).includes(offlineId), 'offline entry was erased from the durable local document');
  await a.w.__load(true);
  assert(a.state.todayRows.some((item) => String(item.id) === offlineId), 'offline entry missing after canonical retry');
  assert(a.state.todayRows.some((item) => String(item.id) === otherId), 'second same-Staff device entry is missing locally');
  assert.strictEqual(a.state.rows[0][5], '40', 'canonical retry double-applied or rolled back the installment delta');
  return 'offline reconnect cannot be overwritten by a pre-offline canonical response';
}

async function staleGetAfterFlushScenario() {
  const env = makeEnvironment();
  const a = await env.createDevice('device-a');
  const b = await env.createDevice('device-b');
  const otherId = await env.add(b, '0003', 'Alice Two', 60);
  await b.w.__flush();

  /* Hold a canonical GET snapshot which does not yet contain device A's next entry. */
  a.holdGet = true;
  const loading = a.w.__load(true);
  await waitFor(() => a.heldGets.length === 1, 'held canonical GET');
  const offlineId = await env.add(a, '0001', 'Alice One', 40);
  await a.w.__flush();
  assert.strictEqual(a.state.outbox.length, 0, 'new entry was not flushed during the held GET');
  assert(todayIds(env.remote.current).includes(offlineId), 'server did not receive the new entry');

  /* The older GET response arrives after the POST completed and the outbox is empty. */
  a.holdGet = false;
  a.heldGets.shift()();
  await loading;
  assert(a.state.todayRows.some((item) => String(item.id) === offlineId), 'stale GET erased an already-synced local entry');

  await a.w.__load(true);
  assert(a.state.todayRows.some((item) => String(item.id) === offlineId), 'entry missing after canonical retry');
  assert(a.state.todayRows.some((item) => String(item.id) === otherId), 'other device entry missing after canonical retry');
  return 'stale GET cannot overwrite a newer local mutation, even with an empty outbox';
}

async function interruptedReconnectReloadScenario() {
  const env = makeEnvironment();
  const a = await env.createDevice('device-a');
  const b = await env.createDevice('device-b');
  a.netAvailable = false;
  a.state.isOnline = false;
  const offlineId = await env.add(a, '0001', 'Alice One', 40);
  await wait(60);
  assert.strictEqual(a.state.outbox.length, 1, 'offline operation was not queued');
  const otherId = await env.add(b, '0003', 'Alice Two', 60);
  await b.w.__flush();

  /* Preserve exactly what an Android/WebView or browser restart would find. */
  const storage = {};
  for (let index = 0; index < a.w.localStorage.length; index += 1) {
    const key = a.w.localStorage.key(index);
    storage[key] = a.w.localStorage.getItem(key);
  }
  const reloaded = await env.createDevice('device-a-reloaded', storage);
  await waitFor(() => reloaded.state.outbox.length === 0
    && reloaded.state.todayRows.some((item) => String(item.id) === otherId), 'reloaded canonical state');
  assert(reloaded.state.todayRows.some((item) => String(item.id) === offlineId), 'reload lost the interrupted offline entry');
  assert(todayIds(env.remote.current).includes(offlineId), 'reload did not flush the interrupted offline entry');
  assert.strictEqual(reloaded.state.rows[0][5], '40', 'reload double-applied or lost the installment delta');
  const cached = JSON.parse(reloaded.w.localStorage.getItem('collectionManager.fullDoc.v1'));
  assert(todayIds(cached).includes(offlineId) && todayIds(cached).includes(otherId), 'reloaded durable document is incomplete');
  return 'interrupted reconnect restores the ordered outbox without double-applying installments';
}

(async () => {
  const tests = [offlineReconnectStaleGetScenario, staleGetAfterFlushScenario, interruptedReconnectReloadScenario];
  let failed = 0;
  for (const test of tests) {
    try { console.log('✅ ' + await test()); }
    catch (error) { failed += 1; console.error('❌ ' + test.name + ' → ' + error.message); }
  }
  console.log(`${tests.length - failed}/${tests.length} reconnect regression tests passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
