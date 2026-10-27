/* Same-installment report corrections must not leave a stale paid archive. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const headers = ['Member Code', 'Member Name', 'Center Code', 'Center Name', 'EmpName', 'Installment Start Date', 'Installment Date Actual', 'Installment Amount', 'Installment Actual', 'LoanSummaryID'];
const makeRow = (actual, paid = actual ? '06-10-2026' : '') => ['0001', 'Ayesha', '001', '001, Center', 'Officer A', '04-10-2026', paid, '100', String(actual), 'L1'];
const oldArchive = {
  key: 'loan:l9|member:9|due:2026-09-04|occ:0', memberCode: '0009', memberName: 'Old Member', centerCode: '009', centerName: 'Old Center', staffName: 'Officer B',
  installmentDate: '2026-09-04', paidDate: '2026-09-06', amount: 900, actual: 900, archivedAt: '2026-09-06T00:00:00.000Z',
};
const clone = (value) => JSON.parse(JSON.stringify(value));
let remote = { headers, rows: [makeRow(100)], collections: [], followups: [], history: [], dailyData: { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [oldArchive] } };
const mergeSource = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8').replace('export function applyPatch', 'function applyPatch').replace(/export \{[^}]+\};?\s*$/, '') + '\nmodule.exports={applyPatch};';
const mergeModule = { exports: {} }; new Function('module', 'exports', mergeSource)(mergeModule, mergeModule.exports);
const patches = [];
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {}; w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); w.confirm = () => true;
w.fetch = async (url, options = {}) => {
  if (options.method === 'POST') {
    const patch = JSON.parse(options.body).patch; patches.push(clone(patch));
    const next = mergeModule.exports.applyPatch(remote, patch); remote = next; remote.updated_at = new Date().toISOString();
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: remote.updated_at }) };
  }
  if (options.method === 'PUT') { remote = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) }; }
  if (String(url).includes('meta=1')) return { ok: true, status: 200, json: async () => ({ updated_at: remote.updated_at || null, counts: {} }) };
  return { ok: true, status: 200, json: async () => clone(remote) };
};
w.eval(fs.readFileSync('shared/csv-rules.js', 'utf8'));
w.eval(fs.readFileSync('app.js', 'utf8') + '\n;window.__state=state;window.__misSlots=misSlots;window.__apply=applyMisFiles;');
const state = w.__state;
const results = [];
const check = async (name, fn) => { try { await fn(); results.push('✅ ' + name); } catch (e) { results.push('❌ ' + name + ' → ' + e.message); process.exitCode = 1; } };
const replaceReport = async (actual) => { w.__misSlots.installment = { rows: [headers, makeRow(actual)] }; await w.__apply(); };
const hasL1 = () => state.paidArchive.some((item) => item.key.startsWith('loan:l1|'));
setTimeout(async () => {
  await check('শুরুতে current paid ও পুরোনো মাসের archive আছে', async () => {
    assert(hasL1()); assert(state.paidArchive.some((item) => item.key === oldArchive.key));
  });
  await check('Paid→due correction-এ matching archive মুছে যায়, পুরোনো মাস টিকে থাকে', async () => {
    await replaceReport(0);
    assert(!hasL1()); assert(state.paidArchive.some((item) => item.key === oldArchive.key));
    const last = patches[patches.length - 1];
    assert(last.paidArchiveRemoveKeys?.some((key) => key.startsWith('loan:l1|')));
    assert(!last.paidArchiveRemoveKeys?.includes(oldArchive.key));
  });
  await check('Due→partial correction-এও stale paid archive ফিরে আসে না', async () => {
    await replaceReport(50); assert(!hasL1()); assert(state.paidArchive.some((item) => item.key === oldArchive.key));
  });
  await check('Partial→paid correction-এ নতুন actual দিয়ে archive ফিরে আসে', async () => {
    await replaceReport(100);
    const item = state.paidArchive.find((entry) => entry.key.startsWith('loan:l1|'));
    assert(item); assert.strictEqual(item.actual, 100); assert(state.paidArchive.some((entry) => entry.key === oldArchive.key));
  });
  console.log(results.join('\n')); const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`); process.exit(failed ? 1 : 0);
}, 700);
