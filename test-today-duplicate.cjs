/* Today: short-code classification, double-tap lock, exact duplicate guard and safe legacy cleanup. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const clone = (value) => JSON.parse(JSON.stringify(value));
const mergeSource = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8')
  .replace('export function applyPatch', 'function applyPatch')
  .replace(/export \{[^}]+\};?\s*$/, '') + '\nmodule.exports = { applyPatch };';
const mergeModule = { exports: {} };
new Function('module', 'exports', mergeSource)(mergeModule, mergeModule.exports);
const { applyPatch } = mergeModule.exports;

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual', 'LoanSummaryID'];
const rows = [
  ['001405686', 'Mrs Hamida Begum', '0155', 'Alice', '10000', '6147', 'H1'],
  ['001405902', 'Mim', '0155', 'Alice', '10000', '0', 'M1'],
  ['001400003', 'Name Only', '0003', 'Alice', '1000', '0', 'N1'],
  ['001400004', 'Twin', '0004', 'Alice', '1000', '0', 'T1'],
  ['001400005', 'Twin', '0005', 'Alice', '1000', '0', 'T2'],
];
const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code'];
const memberDB = [
  ['001405686', 'Mrs Hamida Begum', '0155'],
  ['001405902', 'Mim', '0155'],
];
const legacyEntry = (id, memberCode, memberName, installmentKey, createdAt) => ({
  id, memberCode, centerCode: '0155', memberName, loan: 6147, savings: 353, dps: 0, total: 6500,
  date: '2026-10-24', createdAt, installmentKey, installmentRef: '', ownerStaff: 'Alice', ownerRole: 'staff', ownerDevice: 'old',
  appliedLoan: installmentKey ? 6147 : 0,
});
let remote = {
  headers, rows: clone(rows), collections: [], followups: [], history: [], updated_at: '2026-10-24T00:00:00.000Z',
  dailyData: {
    memberDBHeaders, memberDB: clone(memberDB), balanceHeaders: [], balanceRows: [], paidArchive: [], staffDirectory: [],
    todayRows: [
      legacyEntry('anchored', '001405686', 'Mrs Hamida Begum', 'legacy-installment-key', '2026-10-24T13:30:47.000Z'),
      legacyEntry('duplicate', '5686', 'Mrs Hamida Begum', '', '2026-10-24T13:30:58.000Z'),
    ],
  },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.confirm = () => true;
w.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  if (method === 'POST') {
    remote = applyPatch(remote, JSON.parse(options.body).patch);
    remote.updated_at = new Date().toISOString();
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.updated_at }) };
  }
  if (method === 'PUT') {
    remote = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) };
  }
  if (String(url).includes('meta=1')) return { ok: true, status: 200, json: async () => ({ updated_at: remote.updated_at, counts: {} }) };
  return { ok: true, status: 200, json: async () => clone(remote) };
};
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__flush = flushOutbox;
window.__clearForm = clearTodayForm;
window.__isMonthly = isMonthlyEntry;
`);
const $ = (selector) => w.document.querySelector(selector);
const $$ = (selector) => [...w.document.querySelectorAll(selector)];
const state = w.__state;
const fill = ({ code, center = '', name, loan = 0, savings = 0, dps = 0, raw = '' }) => {
  w.__clearForm();
  state.todayRawMember = raw;
  state.todayRawCenter = raw ? center : '';
  $('#today-member-code').value = code;
  $('#today-center-code').value = center;
  $('#today-member-name').value = name;
  $('#today-loan').value = String(loan);
  $('#today-savings').value = String(savings);
  $('#today-dps').value = String(dps);
  $('#today-total').value = String(loan + savings + dps);
};

setTimeout(async () => {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push('✅ ' + name); }
    catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
  };

  await check('পুরোনো keyless/unapplied exact duplicate সরে; applied আদায় অপরিবর্তিত', async () => {
    await w.__flush();
    assert.strictEqual(state.todayRows.length, 1);
    assert.strictEqual(state.todayRows[0].id, 'anchored');
    assert.strictEqual(state.rows[0][5], '6147', 'কিস্তির টাকা বদলে গেছে');
    assert.strictEqual(remote.dailyData.todayRows.length, 1, 'cleanup Neon-এ sync হয়নি');
    assert.strictEqual($$('#today-other-list tr.today-row').length, 0);
    assert.strictEqual($$('#today-monthly-list tr.today-row').length, 1);
  });

  await check('একই form-এ concurrent double-tap-এ একটি entry ও একবারই কিস্তি যোগ হয়', async () => {
    fill({ code: '5902', center: '0155', name: 'Mim', loan: 100, raw: '001405902' });
    const first = w.__add();
    const second = w.__add();
    await Promise.all([first, second]);
    const entries = state.todayRows.filter((item) => item.memberName === 'Mim');
    assert.strictEqual(entries.length, 1, 'double-tap-এ duplicate হয়েছে');
    assert.strictEqual(entries[0].memberCode, '001405902');
    assert(entries[0].installmentKey, 'installment link নেই');
    assert.strictEqual(state.rows[1][5], '100');
    assert.strictEqual(w.__isMonthly(entries[0]), true);
  });

  await check('Save শেষে short code দিয়ে একই আদায় retry করলেও duplicate হয় না', async () => {
    fill({ code: '5902', center: '0155', name: 'Mim', loan: 100 });
    await w.__add();
    assert.strictEqual(state.todayRows.filter((item) => item.memberName === 'Mim').length, 1);
    assert.strictEqual(state.rows[1][5], '100');
    assert.strictEqual($$('#today-other-list tr.today-row').length, 0);
  });

  await check('একই member-এর ভিন্ন অঙ্কের পরবর্তী আদায় আটকে যায় না', async () => {
    fill({ code: '5902', center: '0155', name: 'Mim', loan: 150 });
    await w.__add();
    assert.strictEqual(state.todayRows.filter((item) => item.memberName === 'Mim').length, 2);
    assert.strictEqual(state.rows[1][5], '250');
    assert.strictEqual($$('#today-other-list tr.today-row').length, 0);
  });

  await check('Directory code না পেলেও কিস্তির unique নাম থেকে full code ও installment পাওয়া যায়', async () => {
    fill({ code: 'unknown', center: '0003', name: 'Name Only', loan: 50 });
    await w.__add();
    const entry = state.todayRows.find((item) => item.memberName === 'Name Only');
    assert(entry, 'entry হয়নি');
    assert.strictEqual(entry.memberCode, '001400003');
    assert(entry.installmentKey);
    assert.strictEqual(w.__isMonthly(entry), true);
    assert.strictEqual(state.rows[2][5], '50');
  });

  await check('একই নামের ভিন্ন member অস্পষ্ট হলে অন্যান্য আদায়ে না ফেলে code চাওয়া হয়', async () => {
    const before = state.todayRows.length;
    fill({ code: 'unknown2', center: '', name: 'Twin', loan: 25 });
    await w.__add();
    assert.strictEqual(state.todayRows.length, before);
    assert(!state.todayRows.some((item) => item.memberName === 'Twin'), 'অস্পষ্ট নামের entry হয়েছে');
  });

  await check('কিস্তি তালিকায় সত্যিই নেই এমন member-এর অন্যান্য আদায় অক্ষত', async () => {
    fill({ code: 'other-1', center: '', name: 'Really Other', savings: 10 });
    await w.__add();
    const entry = state.todayRows.find((item) => item.memberName === 'Really Other');
    assert(entry);
    assert.strictEqual(w.__isMonthly(entry), false);
    assert.strictEqual($$('#today-other-list tr.today-row').length, 1);
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 800);
