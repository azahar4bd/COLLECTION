/* v9.52: every distinct entry syncs; Today duplicate review supports stable Edit/Delete actions. */
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
const html = fs.readFileSync('index.html', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__flush = flushOutbox;
window.__load = loadDB;
window.__showGate = showIdentityGate;
window.__selectIdentity = selectIdentity;
window.__clearForm = clearTodayForm;
window.__showPage = showPage;
window.__close = closeTodayAccount;
window.__duplicateGroups = collectionDuplicateGroups;
window.__renderDuplicateReview = renderDuplicateReview;
`;

function initialRemote() {
  return {
    headers: ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'],
    rows: [['0001', 'Alice One', '001', 'Alice', '1000', '0']],
    collections: [], followups: [], history: [], updated_at: '2026-11-03T00:00:00.000Z',
    dailyData: {
      memberDBHeaders: ['Member No', 'Member Name', 'Center Code & Name'],
      memberDB: [['0001', 'Alice One', '001, One']],
      balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [], staffDirectory: [],
    },
  };
}

function makeEnvironment() {
  const remote = { current: initialRemote() };
  const devices = [];
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 3, 0, 0, ++tick)).toISOString();
  const commit = (patch) => {
    remote.current = applyPatch(remote.current, patch);
    remote.current.updated_at = stamp();
  };
  const createDevice = async (name, storageSnapshot = null) => {
    const w = new JSDOM(html, {
      url: `https://${name}.invalid`, runScripts: 'outside-only', pretendToBeVisual: true,
    }).window;
    if (storageSnapshot) Object.entries(storageSnapshot).forEach(([key, value]) => w.localStorage.setItem(key, value));
    const device = { name, w, netAvailable: true };
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
        remote.current.updated_at = stamp();
        return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.current.updated_at }) };
      }
      if (String(url).includes('meta=1')) {
        return { ok: true, status: 200, json: async () => ({ updated_at: remote.current.updated_at, counts: {} }) };
      }
      return { ok: true, status: 200, json: async () => clone(remote.current) };
    };
    w.eval(appSource);
    device.state = w.__state;
    devices.push(device);
    await waitFor(() => device.state.rows.length === 1 && device.state.savedDoc, `${name} initial load`);
    w.__showGate();
    const select = w.document.querySelector('#identity-select');
    const alice = [...select.options].find((option) => option.value.startsWith('staff|') && option.value.includes('Alice'));
    assert(alice, `${name}: Staff identity unavailable`);
    select.value = alice.value;
    w.__selectIdentity();
    return device;
  };
  const add = async (device, loan) => {
    const $ = (selector) => device.w.document.querySelector(selector);
    const before = new Set(device.state.todayRows.map((item) => String(item.id)));
    device.w.__clearForm();
    $('#today-member-code').value = '0001';
    $('#today-center-code').value = '001';
    $('#today-member-name').value = 'Alice One';
    $('#today-loan').value = String(loan);
    $('#today-savings').value = '0';
    $('#today-dps').value = '0';
    $('#today-total').value = String(loan);
    await device.w.__add();
    await wait(25);
    const entry = device.state.todayRows.find((item) => !before.has(String(item.id)));
    assert(entry, `${device.name}: entry was not created`);
    return String(entry.id);
  };
  return { remote, createDevice, add, devices };
}

async function waitFor(predicate, label, timeout = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timeout waiting for ${label}`);
    await wait(5);
  }
}
const todayIds = (doc) => (doc.dailyData?.todayRows || []).map((item) => String(item.id));
const storageOf = (device) => {
  const result = {};
  for (let index = 0; index < device.w.localStorage.length; index += 1) {
    const key = device.w.localStorage.key(index);
    result[key] = device.w.localStorage.getItem(key);
  }
  return result;
};

async function exactOfflineEntriesSurvive() {
  const env = makeEnvironment();
  const a = await env.createDevice('exact-a');
  const b = await env.createDevice('exact-b');
  b.netAvailable = false;
  b.state.isOnline = false;
  const offlineOne = await env.add(b, 40);
  const offlineTwo = await env.add(b, 40);
  assert.strictEqual(b.state.todayRows.length, 2, 'offline exact entry was blocked or removed');
  assert.strictEqual(b.state.outbox.length, 2, 'offline ordered operations were not preserved');
  b.w.__showPage('today');
  assert.strictEqual(b.w.__duplicateGroups()[0].entries.length, 2);
  assert.strictEqual(b.w.document.querySelectorAll('.duplicate-pending').length, 2, 'offline pending state is not visible');

  const online = await env.add(a, 40);
  await a.w.__flush();
  assert(todayIds(env.remote.current).includes(online), 'online entry did not sync');
  b.netAvailable = true;
  b.state.isOnline = true;
  await b.w.__flush();
  await b.w.__load(true);
  const ids = todayIds(env.remote.current);
  assert.strictEqual(ids.length, 3, 'an exact duplicate was rejected by sync');
  assert(new Set(ids).size === 3, 'entries lost their distinct IDs');
  assert(ids.includes(offlineOne) && ids.includes(offlineTwo) && ids.includes(online));
  assert.strictEqual(env.remote.current.rows[0][5], '120', 'Actual does not include all three entries');
  assert.strictEqual(b.state.todayRows.length, 3, 'reconnect lost a local entry');
  assert.strictEqual(b.state.outbox.length, 0);
  assert.strictEqual(b.w.__duplicateGroups()[0].exact, true);

  const reloaded = await env.createDevice('exact-b-reloaded', storageOf(b));
  await reloaded.w.__load(true);
  assert.strictEqual(reloaded.state.todayRows.length, 3, 'reload lost an offline/synced entry');
  assert.strictEqual(reloaded.state.outbox.length, 0);
  reloaded.w.__showPage('today');
  assert.strictEqual(reloaded.w.document.querySelectorAll('.duplicate-entry-row').length, 3);
  return 'exact duplicates from offline/online devices all sync, survive reload, and remain reviewable';
}

async function amountConflictStillSyncs() {
  const env = makeEnvironment();
  const a = await env.createDevice('conflict-a');
  const b = await env.createDevice('conflict-b');
  const first = await env.add(a, 40);
  await a.w.__flush();
  b.netAvailable = false;
  b.state.isOnline = false;
  const second = await env.add(b, 60);
  b.netAvailable = true;
  b.state.isOnline = true;
  await b.w.__flush();
  await b.w.__load(true);
  const ids = todayIds(env.remote.current);
  assert.strictEqual(ids.length, 2, 'amount conflict was blocked');
  assert(ids.includes(first) && ids.includes(second));
  assert.strictEqual(env.remote.current.rows[0][5], '100');
  b.w.__showPage('today');
  const group = b.w.__duplicateGroups()[0];
  assert(group && !group.exact && group.entries.length === 2);
  assert(b.w.document.querySelector('.duplicate-group-row').textContent.includes('Amount conflict'));
  const amounts = [...b.w.document.querySelectorAll('.duplicate-entry-row')].map((row) => row.textContent);
  assert(amounts.some((text) => text.includes('40')) && amounts.some((text) => text.includes('60')));
  return 'amount-conflict entries are not rejected; both amounts and conflict badge are visible';
}

async function todayAndHistoryShareReviewTable() {
  const env = makeEnvironment();
  const a = await env.createDevice('history-a');
  await env.add(a, 25);
  await env.add(a, 30);
  await a.w.__flush();
  await a.w.__close();
  await a.w.__flush();
  assert.strictEqual(a.state.todayRows.length, 0);
  assert.strictEqual(a.state.history.length, 2, 'Close did not preserve both entries');
  await env.add(a, 40);
  await a.w.__flush();
  a.w.__showPage('today');
  const groups = a.w.__duplicateGroups();
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].entries.length, 3);
  assert(!groups[0].exact);
  assert(groups[0].entries.some((entry) => entry.source === 'Today'));
  assert(groups[0].entries.filter((entry) => entry.source === 'হিসাবের খাতা').length === 2);
  assert.strictEqual(a.w.document.querySelectorAll('.duplicate-entry-row').length, 3);
  const historyRow = a.w.document.querySelector('.duplicate-entry-row[data-entry-source="হিসাবের খাতা"]');
  const historyId = historyRow.dataset.entryId;
  const deletedLoan = Number(a.state.history.find((item) => String(item.id) === historyId).loan);
  const survivingTodayId = String(a.state.todayRows[0].id);
  historyRow.querySelector('[data-edit-history]').click();
  assert.strictEqual(a.state.editingHistoryId, historyId, 'history Edit did not use the stable ID');
  a.w.document.querySelector('#btn-cancel-edit').click();
  const refreshedHistoryRow = a.w.document.querySelector(`.duplicate-entry-row[data-entry-id="${historyId}"]`);
  refreshedHistoryRow.querySelector('[data-del-history]').click();
  await waitFor(() => a.state.history.length === 1, 'confirmed history delete');
  await a.w.__flush();
  assert.strictEqual(a.state.todayRows.length, 1, 'unrelated Today entry was lost');
  assert.strictEqual(env.remote.current.history.length, 1);
  assert.strictEqual(env.remote.current.dailyData.todayRows.length, 1);
  assert.notStrictEqual(String(env.remote.current.history[0].id), historyId, 'confirmed history target was not deleted');
  assert.strictEqual(String(env.remote.current.dailyData.todayRows[0].id), survivingTodayId);
  assert.strictEqual(env.remote.current.rows[0][5], String(95 - deletedLoan), 'history delete reversed the wrong installment amount');
  return 'Today and হিসাবের খাতা share review; history Edit/Delete preserve unrelated entries and Actual';
}

async function closedPairExcludesOtherEntries() {
  const env = makeEnvironment();
  const a = await env.createDevice('pair-only-a');
  await env.add(a, 25);
  await env.add(a, 25);
  await a.w.__flush();
  await a.w.__close();
  await a.w.__flush();
  const duplicateIds = a.state.history.map((item) => String(item.id));
  assert.strictEqual(duplicateIds.length, 2, 'the closed duplicate pair is not in হিসাবের খাতা');

  /* An unrelated ordinary Today entry must remain in Today, not in the review table. */
  const $ = (selector) => a.w.document.querySelector(selector);
  a.w.__clearForm();
  $('#today-member-code').value = 'other-x';
  $('#today-center-code').value = '';
  $('#today-member-name').value = 'Other Ordinary Entry';
  $('#today-loan').value = '0';
  $('#today-savings').value = '10';
  $('#today-dps').value = '0';
  $('#today-total').value = '10';
  await a.w.__add();
  await a.w.__flush();
  const ordinaryId = String(a.state.todayRows[0].id);
  a.w.__showPage('today');
  const groups = a.w.__duplicateGroups();
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].entries.length, 2);
  assert.strictEqual(a.state.history.length, 2, 'duplicate pair was removed from history');
  assert.strictEqual(a.state.todayRows.length, 1, 'ordinary entry was lost from Today');
  const reviewRows = [...a.w.document.querySelectorAll('.duplicate-entry-row')];
  assert.strictEqual(reviewRows.length, 2, 'a non-duplicate entry appeared in the duplicate table');
  assert(reviewRows.every((row) => duplicateIds.includes(row.dataset.entryId)));
  assert(!reviewRows.some((row) => row.dataset.entryId === ordinaryId));
  assert(reviewRows.every((row) => row.dataset.entrySource === 'হিসাবের খাতা'));
  assert.strictEqual(env.remote.current.history.length, 2);
  assert.strictEqual(env.remote.current.dailyData.todayRows.length, 1);
  return 'closed duplicate pair stays in হিসাবের খাতা; only that pair appears in review, never ordinary entries';
}

async function reviewTodayEditDeleteActions() {
  const env = makeEnvironment();
  const a = await env.createDevice('actions-a');
  const first = await env.add(a, 40);
  const second = await env.add(a, 40);
  await a.w.__flush();
  a.w.__showPage('today');
  assert.strictEqual(a.w.document.querySelectorAll('.duplicate-entry-row').length, 2);
  const originalIdentity = a.state.identity;
  a.state.identity = { role: 'manager', staff: '', label: 'Manager' };
  a.w.__renderDuplicateReview();
  assert.strictEqual(a.w.document.querySelectorAll('#duplicate-review-list [data-edit-today], #duplicate-review-list [data-del-today]').length, 0, 'Manager got write actions');
  a.state.identity = originalIdentity;
  a.w.__renderDuplicateReview();

  const firstRow = a.w.document.querySelector(`.duplicate-entry-row[data-entry-id="${first}"]`);
  firstRow.querySelector('[data-edit-today]').click();
  assert.strictEqual(a.state.editingTodayId, first, 'Today Edit did not retain the stable ID');
  const $ = (selector) => a.w.document.querySelector(selector);
  $('#today-loan').value = '50';
  $('#today-total').value = '50';
  await a.w.__add();
  await a.w.__flush();
  assert.strictEqual(a.state.todayRows.length, 2, 'Edit created a duplicate instead of updating');
  assert.strictEqual(new Set(todayIds(env.remote.current)).size, 2);
  assert(todayIds(env.remote.current).includes(first) && todayIds(env.remote.current).includes(second));
  assert.strictEqual(env.remote.current.rows[0][5], '90', 'Edit did not preserve the other entry/Actual');

  const secondRow = a.w.document.querySelector(`.duplicate-entry-row[data-entry-id="${second}"]`);
  secondRow.querySelector('[data-del-today]').click();
  await waitFor(() => a.state.todayRows.length === 1, 'confirmed Today delete');
  await a.w.__flush();
  assert.strictEqual(todayIds(env.remote.current).length, 1);
  assert.strictEqual(todayIds(env.remote.current)[0], first, 'the wrong duplicate entry was deleted');
  assert.strictEqual(a.state.todayRows[0].id, first);
  assert.strictEqual(env.remote.current.rows[0][5], '50', 'Delete reversed the wrong installment amount');
  return 'review Edit keeps the same ID; confirmed Delete removes only its target and preserves the survivor';
}

(async () => {
  const tests = [exactOfflineEntriesSurvive, amountConflictStillSyncs, todayAndHistoryShareReviewTable, closedPairExcludesOtherEntries, reviewTodayEditDeleteActions];
  let failed = 0;
  for (const test of tests) {
    try { console.log('✅ ' + await test()); }
    catch (error) { failed += 1; console.error('❌ ' + test.name + ' → ' + error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} sync-all/review regression tests passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
