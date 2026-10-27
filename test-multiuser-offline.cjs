/* v9.18: role-scoped UI, own-entry CRUD, offline outbox and multi-device merge. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

/* Load the exact shared merge used by Netlify/sandbox into this CJS harness. */
const mergeSource = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8')
  .replace('export function applyPatch', 'function applyPatch')
  .replace(/export \{[^}]+\};?\s*$/, '')
  + '\nmodule.exports = { applyPatch };';
const mergeModule = { exports: {} };
new Function('module', 'exports', mergeSource)(mergeModule, mergeModule.exports);
const { applyPatch } = mergeModule.exports;

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Start Date', 'Installment Date Actual', 'Installment Amount', 'Installment Actual', 'LoanSummaryID'];
const rows = [
  ['0001', 'Alice One', '001', 'Alice', '04-10-2026', '', '100', '0', 'L1'],
  ['0002', 'Bob One', '002', 'Bob', '04-10-2026', '', '200', '0', 'L2'],
  ['0003', 'Alice Two', '003', 'Alice', '04-10-2026', '', '300', '0', 'L3'],
];
const memberDBHeaders = ['Member No', 'Member Name', 'Center Code & Name'];
const memberDB = [
  ['0001', 'Alice One', '001, One'],
  ['0002', 'Bob One', '002, Two'],
  ['0003', 'Alice Two', '003, Three'],
];
const clone = (value) => JSON.parse(JSON.stringify(value));
let remote = {
  headers, rows: clone(rows), collections: [], followups: [], history: [], updated_at: '2026-10-24T00:00:00.000Z',
  dailyData: { memberDBHeaders, memberDB: clone(memberDB), balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [] },
};
const writes = [];
let failPost = false;
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.confirm = () => true;
w.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  if (method === 'POST') {
    if (failPost) throw new Error('simulated network drop');
    const patch = JSON.parse(options.body).patch;
    writes.push(clone(patch));
    remote = applyPatch(remote, patch);
    remote.updated_at = new Date().toISOString();
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.updated_at }) };
  }
  if (method === 'PUT') {
    remote = JSON.parse(options.body);
    remote.updated_at = new Date().toISOString();
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.updated_at }) };
  }
  if (String(url).includes('meta=1')) return { ok: true, status: 200, json: async () => ({ updated_at: remote.updated_at, counts: {} }) };
  return { ok: true, status: 200, json: async () => clone(remote) };
};
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__selectIdentity = selectIdentity;
window.__add = addTodayRow;
window.__edit = startEditToday;
window.__delete = deleteTodayRow;
window.__sync = syncIfChanged;
window.__render = renderAll;
window.__filteredRows = filteredRows;
window.__filteredHistory = filteredHistory;
window.__filteredArchive = filteredPaidArchive;
window.__canCollect = canCollect;
window.__canUpdate = canUpdateDatabase;
window.__showGate = showIdentityGate;
window.__persist = persistRows;
window.__flush = flushOutbox;
`);
const $ = (selector) => w.document.querySelector(selector);
const state = w.__state;
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push('✅ ' + name); }
  catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
};
const identity = async (role, staff = '') => {
  w.__showGate();
  $('#identity-select').value = `${role}|${encodeURIComponent(staff)}`;
  await w.__selectIdentity();
};
const setEntry = (code, name, loan, savings = 0) => {
  $('#today-member-code').value = code;
  $('#today-member-name').value = name;
  $('#today-loan').value = String(loan);
  $('#today-savings').value = String(savings);
  $('#today-dps').value = '0';
  $('#today-total').value = '';
};
const otherEntry = (id, code, name, staff, loan) => ({
  id, date: '2026-10-24', createdAt: '2026-10-24T01:00:00.000Z', memberCode: code, memberName: name,
  centerCode: code === '0002' ? '002' : '001', ownerStaff: staff, ownerRole: 'staff', ownerDevice: 'other-device',
  installmentKey: '', installmentRef: '', kind: 'monthly', loan, savings: 0, dps: 0, total: loan,
});

setTimeout(async () => {
  await check('প্রবেশের dropdown-এ staff + Manager + Admin আছে', async () => {
    const options = [...$('#identity-select').options].map((option) => option.value);
    assert(options.includes('staff|Alice'), options.join(','));
    assert(options.includes('staff|Bob'));
    assert(options.includes('manager|') && options.includes('admin|'));
  });

  await check('Staff শুধু নিজের rows, directory, Today/history/archive দেখে', async () => {
    await identity('staff', 'Alice');
    assert.deepStrictEqual(w.__filteredRows().map((row) => row[0]).sort(), ['0001', '0003']);
    assert.strictEqual(state.filters.staff, 'Alice');
    assert.strictEqual(w.__canCollect(), true);
    assert.strictEqual(w.__canUpdate(), false);
    assert.strictEqual(w.__filteredHistory().length, 0);
    assert.strictEqual(w.__filteredArchive().length, 0);
    assert.strictEqual($('#fi-staff').classList.contains('hidden'), false); // CSS hides it; DOM remains usable for tests/accessibility.
    assert($('#btn-member-db').classList.contains('role-hidden'));
  });

  await check('Staff নিজের এন্ট্রি করতে পারে এবং owner/ID সংরক্ষিত হয়', async () => {
    setEntry('0001', 'Alice One', 40, 5);
    await w.__add();
    assert.strictEqual(state.todayRows.length, 1);
    assert.strictEqual(state.todayRows[0].ownerStaff, 'Alice');
    assert(state.todayRows[0].id);
    await w.__flush();
    assert.strictEqual(remote.dailyData.todayRows.length, 1);
    assert.strictEqual(remote.rows[0][7], '40');
  });

  await check('Staff অন্য staff-এর সদস্যের এন্ট্রি বা edit করতে পারে না', async () => {
    const before = state.todayRows.length;
    setEntry('0002', 'Bob One', 20);
    await w.__add();
    assert.strictEqual(state.todayRows.length, before);
    await w.__delete(0); // own entry remains allowed; this check is completed below with a foreign entry
    await w.__flush();
    assert.strictEqual(state.todayRows.length, before - 1);
  });

  await check('Manager সব rows দেখে কিন্তু mutation/upload করতে পারে না', async () => {
    await identity('manager');
    assert.strictEqual(w.__filteredRows().length, 3);
    assert.strictEqual(w.__canCollect(), false);
    assert.strictEqual(w.__canUpdate(), false);
    const before = state.todayRows.length;
    setEntry('0001', 'Alice One', 10);
    await w.__add();
    assert.strictEqual(state.todayRows.length, before);
    assert($('#btn-settings').classList.contains('role-hidden'));
  });

  await check('Offline entry ডিভাইসে থাকে, server-এ তৎক্ষণাৎ যায় না এবং queue-এর ID patch হয়', async () => {
    await identity('staff', 'Alice');
    state.isOnline = false;
    setEntry('0001', 'Alice One', 25);
    await w.__add();
    assert.strictEqual(state.todayRows.length, 1);
    assert.strictEqual(state.outbox.length, 1);
    assert(state.outbox[0].patch.todayUpserts);
    assert.strictEqual(remote.dailyData.todayRows.length, 0);
    assert.strictEqual(remote.rows[0][7], '0');
  });

  await check('Offline edit আলাদা ordered operation হিসেবে জমা হয়', async () => {
    w.__edit(0);
    $('#today-loan').value = '35';
    $('#today-total').value = '';
    await w.__add();
    assert.strictEqual(state.todayRows[0].loan, 35);
    assert.strictEqual(state.outbox.length, 2);
    assert.strictEqual(state.outbox[1].patch.todayUpserts[0].id, state.outbox[0].patch.todayUpserts[0].id);
  });

  await check('Reconnect-এ queue sync হয় এবং অন্য ডিভাইসের আলাদা entry হারায় না', async () => {
    remote = applyPatch(remote, { todayUpserts: [otherEntry('bob-remote', '0002', 'Bob One', 'Bob', 70)] });
    state.isOnline = true;
    await w.__sync(true);
    assert.strictEqual(state.outbox.length, 0);
    assert.strictEqual(remote.dailyData.todayRows.length, 2);
    assert.strictEqual(remote.rows[0][7], '35');
    assert.strictEqual(remote.rows[1][7], '70');
    assert.strictEqual(state.todayRows.length, 2);
    assert.strictEqual(w.__filteredRows().length, 2); // Alice's two installment rows
    assert.strictEqual(w.__filteredHistory().length, 0);
  });

  await check('Admin সব device-এর merged entry দেখে এবং staff-এর foreign entry-তে staff edit guard কাজ করে', async () => {
    await identity('admin');
    assert.strictEqual(state.todayRows.length, 2);
    await identity('staff', 'Alice');
    const foreignIndex = state.todayRows.findIndex((item) => item.id === 'bob-remote');
    assert(foreignIndex >= 0);
    const before = state.todayRows.length;
    await w.__delete(foreignIndex);
    assert.strictEqual(state.todayRows.length, before);
    assert.strictEqual(w.__filteredRows().length, 2);
  });

  await check('Admin database save network drop-এ stale full-document offline queue-তে যায় না', async () => {
    await identity('admin');
    const original = state.rows[0][7];
    const outboxBefore = state.outbox.length;
    state.rows[0][7] = String(Number(original || 0) + 1);
    failPost = true;
    let rejected = false;
    try { await w.__persist({ allowOffline: false }); }
    catch { rejected = true; }
    finally { failPost = false; state.rows[0][7] = original; }
    assert.strictEqual(rejected, true);
    assert.strictEqual(state.outbox.length, outboxBefore);
    state.isOnline = false;
    rejected = false;
    try { await w.__persist({ allowOffline: false }); }
    catch { rejected = true; }
    finally { state.isOnline = true; }
    assert.strictEqual(rejected, true);
    assert.strictEqual(state.outbox.length, outboxBefore);
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  process.exit(failed ? 1 : 0);
}, 700);
