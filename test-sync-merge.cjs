/* Server merge contract: independent devices, ordered offline operations and legacy IDs. */
const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8')
  .replace('export function applyPatch', 'function applyPatch')
  .replace(/export \{[^}]+\};?\s*$/, '')
  + '\nmodule.exports = { applyPatch };';
const constModule = { exports: {} };
new Function('module', 'exports', source)(constModule, constModule.exports);
const { applyPatch } = constModule.exports;

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Start Date', 'Installment Date Actual', 'Installment Amount', 'Installment Actual', 'LoanSummaryID'];
const rows = [
  ['001', 'A', '001', 'Alice', '04-10-2026', '', '100', '0', 'L1'],
  ['002', 'B', '002', 'Bob', '04-10-2026', '', '200', '0', 'L2'],
];
const entry = (id, code, loan, extra = {}) => ({
  id, date: '2026-10-24', memberCode: code, memberName: code, centerCode: code === '001' ? '001' : '002',
  installmentKey: '', installmentRef: `loan:l${code === '001' ? '1' : '2'}|member:${Number(code)}|due:2026-10-04|occ:0`,
  kind: 'monthly', loan, savings: 0, dps: 0, total: loan, ...extra,
});
const results = [];
const check = (name, fn) => {
  try { fn(); results.push('✅ ' + name); }
  catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
};
let doc = { headers, rows: JSON.parse(JSON.stringify(rows)), dailyData: { todayRows: [] }, history: [] };

check('দুই ডিভাইসের আলাদা Today entry মুছে না গিয়ে merge হয়', () => {
  doc = applyPatch(doc, { todayUpserts: [entry('a', '001', 40)] });
  doc = applyPatch(doc, { todayUpserts: [entry('b', '002', 70)] });
  assert.strictEqual(doc.dailyData.todayRows.length, 2);
  assert.strictEqual(doc.rows[0][7], '40');
  assert.strictEqual(doc.rows[1][7], '70');
});

check('একই entry-এর edit শুধু loan delta প্রয়োগ করে', () => {
  doc = applyPatch(doc, { todayUpserts: [entry('a', '001', 60)] });
  assert.strictEqual(doc.rows[0][7], '60');
  assert.strictEqual(doc.rows[1][7], '70');
});

check('Today→history close-এ actual দ্বিগুণ হয় না', () => {
  doc = applyPatch(doc, { todayRemoveIds: ['a'], historyUpserts: [entry('a', '001', 60, { closedAt: '2026-10-24T02:00:00Z' })] });
  assert.strictEqual(doc.dailyData.todayRows.length, 1);
  assert.strictEqual(doc.history.length, 1);
  assert.strictEqual(doc.rows[0][7], '60');
});

check('History→Today Undo-তেও actual অপরিবর্তিত; পরবর্তী Close-এও দ্বিগুণ হয় না', () => {
  doc = applyPatch(doc, { historyRemoveIds: ['a'], todayUpserts: [entry('a', '001', 60)] });
  assert.strictEqual(doc.dailyData.todayRows.length, 2);
  assert.strictEqual(doc.history.length, 0);
  assert.strictEqual(doc.rows[0][7], '60', 'Undo-এ actual বদলেছে');
  doc = applyPatch(doc, { todayRemoveIds: ['a'], historyUpserts: [entry('a', '001', 60, { closedAt: '2026-10-24T02:05:00Z', closeBatchId: 'close-test-2' })] });
  assert.strictEqual(doc.dailyData.todayRows.length, 1);
  assert.strictEqual(doc.history.length, 1);
  assert.strictEqual(doc.rows[0][7], '60', 'পুনরায় Close-এ actual বদলেছে');
});

check('History delete-এ আদায় ও আদায়ের তারিখ ফিরে যায়', () => {
  doc = applyPatch(doc, { historyRemoveIds: ['a'] });
  assert.strictEqual(doc.history.length, 0);
  assert.strictEqual(doc.rows[0][7], '0');
  assert.strictEqual(doc.rows[0][5], '');
  assert.strictEqual(doc.rows[1][7], '70');
});

check('Member বদলালে পুরোনো row থেকে বিয়োগ, নতুন row-তে যোগ', () => {
  doc = applyPatch(doc, { todayUpserts: [entry('b', '001', 30)] });
  assert.strictEqual(doc.rows[0][7], '30');
  assert.strictEqual(doc.rows[1][7], '0');
});

check('Legacy ID-বিহীন entry-ও deterministic merge পায়', () => {
  let legacy = { headers, rows: JSON.parse(JSON.stringify(rows)), dailyData: { todayRows: [{ ...entry('legacy', '001', 20), id: undefined }] }, history: [] };
  const first = applyPatch(legacy, { todayUpserts: [{ ...entry('new', '002', 10) }] });
  assert.strictEqual(first.dailyData.todayRows.length, 2);
  assert(first.dailyData.todayRows.every((item) => item.id));
});

check('দুই ডিভাইসের আদায় মিলে full হলে server archive-এ merged actual যায়', () => {
  let full = { headers, rows: [JSON.parse(JSON.stringify(rows[0]))], dailyData: { todayRows: [], paidArchive: [] }, history: [] };
  full = applyPatch(full, { todayUpserts: [entry('full-a', '001', 60)] });
  assert.strictEqual(full.dailyData.paidArchive.length, 0);
  full = applyPatch(full, { todayUpserts: [entry('full-b', '001', 60)] });
  assert.strictEqual(full.rows[0][7], '120');
  assert.strictEqual(full.dailyData.paidArchive.length, 1);
  assert.strictEqual(full.dailyData.paidArchive[0].actual, 120);
  full = applyPatch(full, { todayRemoveIds: ['full-a'] });
  assert.strictEqual(full.rows[0][7], '60');
  assert.strictEqual(full.dailyData.paidArchive.length, 0);
});

check('Staff directory patch অন্য ডিভাইসের directory-কে replace না করে মেলায়', () => {
  let merged = applyPatch(doc, { staffDirectory: [{ name: 'Alice', centers: ['001'], members: ['001'] }] });
  merged = applyPatch(merged, { staffDirectory: [{ name: 'Bob', centers: ['002'], members: ['002'] }] });
  assert.deepStrictEqual(merged.dailyData.staffDirectory.map((item) => item.name).sort(), ['Alice', 'Bob']);
  assert.deepStrictEqual(merged.dailyData.staffDirectory.find((item) => item.name === 'Alice').centers, ['001']);
});

console.log(results.join('\n'));
const failed = results.filter((line) => line.startsWith('❌')).length;
console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
process.exit(failed ? 1 : 0);
