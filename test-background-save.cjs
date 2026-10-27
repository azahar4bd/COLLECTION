/* Instant local save + ordered background Neon flush; Admin save stays synchronous. */
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

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
let remote = {
  headers,
  rows: [
    ['0001', 'Alice One', '001', 'Alice', '100', '0'],
    ['0003', 'Alice Two', '003', 'Alice', '100', '0'],
  ],
  collections: [], followups: [], history: [], updated_at: '2026-10-24T00:00:00.000Z',
  dailyData: {
    memberDBHeaders: ['Member No', 'Member Name', 'Center Code & Name'],
    memberDB: [['0001', 'Alice One', '001, One'], ['0003', 'Alice Two', '003, Three']],
    balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [], staffDirectory: [],
  },
};
const attempts = [];
const held = [];
let holdPost = false;
let failPost = false;
const response = () => ({ ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.updated_at }) });
const commit = (patch) => {
  remote = applyPatch(remote, patch);
  remote.updated_at = new Date().toISOString();
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  if (method === 'POST') {
    const patch = clone(JSON.parse(options.body).patch);
    attempts.push(patch);
    if (failPost) return { ok: false, status: 500, json: async () => ({ error: 'simulated server delay failure' }) };
    if (holdPost) {
      return new Promise((resolve) => {
        held.push(() => { commit(patch); resolve(response()); });
      });
    }
    commit(patch);
    return response();
  }
  if (method === 'PUT') {
    remote = JSON.parse(options.body);
    remote.updated_at = new Date().toISOString();
    return response();
  }
  if (String(url).includes('meta=1')) {
    return { ok: true, status: 200, json: async () => ({ updated_at: remote.updated_at, counts: {} }) };
  }
  return { ok: true, status: 200, json: async () => clone(remote) };
};
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__flush = flushOutbox;
window.__persist = persistRows;
window.__selectIdentity = selectIdentity;
window.__showGate = showIdentityGate;
`);
const $ = (selector) => w.document.querySelector(selector);
const state = w.__state;
const setEntry = (code, name, loan) => {
  $('#today-member-code').value = code;
  $('#today-member-name').value = name;
  $('#today-loan').value = String(loan);
  $('#today-savings').value = '0';
  $('#today-dps').value = '0';
  $('#today-total').value = '';
};
const within = async (promise, ms) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${ms}ms-এর মধ্যে শেষ হয়নি—network-এর অপেক্ষা করছে`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
};

setTimeout(async () => {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push('✅ ' + name); }
    catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
  };
  let firstId = '';
  let secondId = '';

  await check('ধীর server-এর অপেক্ষা না করে Today save ও form clear; local copy durable', async () => {
    w.__showGate();
    $('#identity-select').value = 'staff|Alice';
    w.__selectIdentity();
    attempts.length = 0;
    holdPost = true;
    setEntry('0001', 'Alice One', 40);
    const started = Date.now();
    await within(w.__add(), 300);
    assert(Date.now() - started < 300, 'save network-এর অপেক্ষা করেছে');
    assert.strictEqual(state.todayRows.length, 1);
    firstId = state.todayRows[0].id;
    assert.strictEqual($('#today-member-code').value, '', 'form clear হয়নি');
    assert.strictEqual(state.outbox.length, 1);
    assert.strictEqual(remote.dailyData.todayRows.length, 0, 'held server-এ entry চলে গেছে');
    const cachedOutbox = JSON.parse(w.localStorage.getItem('collectionManager.offlineOutbox.v1'));
    const cachedDoc = JSON.parse(w.localStorage.getItem('collectionManager.fullDoc.v1'));
    assert.strictEqual(cachedOutbox.length, 1, 'outbox localStorage-এ নেই');
    assert.strictEqual(cachedDoc.dailyData.todayRows[0].id, firstId, 'full local document-এ entry নেই');
    await wait(70);
    assert.strictEqual(attempts.length, 1, 'background request শুরু হয়নি');
    assert.strictEqual(held.length, 1, 'প্রথম response hold হয়নি');
  });

  await check('প্রথম request আটকে থাকলেও দ্বিতীয় save স্থানীয়ভাবে হয়; server order ভাঙে না', async () => {
    setEntry('0003', 'Alice Two', 60);
    await within(w.__add(), 300);
    assert.strictEqual(state.todayRows.length, 2);
    secondId = state.todayRows[0].id;
    assert.notStrictEqual(secondId, firstId);
    assert.strictEqual(state.outbox.length, 2);
    await wait(70);
    assert.strictEqual(attempts.length, 1, 'প্রথম response-এর আগেই দ্বিতীয় request পাঠানো হয়েছে');
    assert.strictEqual(remote.dailyData.todayRows.length, 0);
    assert.strictEqual(JSON.parse(w.localStorage.getItem('collectionManager.offlineOutbox.v1')).length, 2);
  });

  await check('Response এলে ordered flush হয়; দুই entry-ই Neon merge-এ থাকে', async () => {
    holdPost = false;
    held.shift()();
    await within(w.__flush(), 500);
    assert.strictEqual(attempts.length, 2);
    assert.strictEqual(attempts[0].todayUpserts[0].id, firstId, 'প্রথম operation বদলে গেছে');
    assert.strictEqual(attempts[1].todayUpserts[0].id, secondId, 'দ্বিতীয় operation আগে চলে গেছে');
    assert.strictEqual(state.outbox.length, 0);
    assert.strictEqual(remote.dailyData.todayRows.length, 2);
    assert.strictEqual(remote.rows[0][5], '40');
    assert.strictEqual(remote.rows[1][5], '60');
    assert.strictEqual(JSON.parse(w.localStorage.getItem('collectionManager.offlineOutbox.v1')).length, 0);
  });

  await check('Background server failure-এ local entry ও queue থাকে; retry-তে sync হয়', async () => {
    failPost = true;
    setEntry('0001', 'Alice One', 5);
    await within(w.__add(), 300);
    assert.strictEqual(state.todayRows.length, 3);
    await wait(90);
    assert.strictEqual(state.outbox.length, 1, 'ব্যর্থ operation queue থেকে মুছে গেছে');
    assert.strictEqual(remote.dailyData.todayRows.length, 2, 'ব্যর্থ entry server-এ লেখা হয়েছে');
    failPost = false;
    await within(w.__flush(), 500);
    assert.strictEqual(state.outbox.length, 0);
    assert.strictEqual(remote.dailyData.todayRows.length, 3);
    assert.strictEqual(state.todayRows.length, 3, 'retry-তে স্থানীয় entry হারিয়েছে');
  });

  await check('Admin synchronous save server response না আসা পর্যন্ত অপেক্ষা করে ও queue করে না', async () => {
    attempts.length = 0;
    holdPost = true;
    state.rows[0][5] = '50';
    let settled = false;
    const saving = w.__persist({ allowOffline: false }).then(() => { settled = true; });
    await wait(80);
    assert.strictEqual(settled, false, 'Admin save response-এর আগেই শেষ হয়েছে');
    assert.strictEqual(state.outbox.length, 0, 'Admin save background outbox-এ গেছে');
    assert.strictEqual(held.length, 1);
    holdPost = false;
    held.shift()();
    await within(saving, 500);
    assert.strictEqual(settled, true);
    assert.strictEqual(remote.rows[0][5], '50');
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 700);
