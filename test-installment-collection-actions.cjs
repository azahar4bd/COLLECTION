/* Installment pages: details-এ কল + আদায়, exact installment targeting ও origin Return. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual', 'Installment Date', 'Mobile'];
const rows = [
  ['001', 'Primary Loan', 'C1', 'Alice', '1000', '0', today, '01700000001'],
  ['001', 'Primary Loan', 'C1', 'Alice', '500', '0', today, '01700000001'],
  ['002', 'Partial Member', 'C2', 'Bob', '1000', '400', today, '01700000002'],
  ['003', 'Paid Member', 'C3', 'Alice', '1000', '1000', today, '01700000003'],
];
const cloud = {
  updated_at: new Date().toISOString(), headers, rows, collections: [], history: [],
  followups: [{ key: 'code:1', promise: 'আজ আসবে', nextDate: today, givenDate: today, memberCode: '001', memberName: 'Primary Loan' }],
  dailyData: { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], paidArchive: [], staffDirectory: [], todayRows: [] },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://collection-actions.test/', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.confirm = () => true;
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.fetch = async (url, options = {}) => ({ ok: true, status: 200, json: async () => ['POST', 'PUT'].includes(options.method) ? { ok: true, updated_at: cloud.updated_at } : cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + '\n;window.__state=state;window.__showPage=showPage;window.__rowKey=installmentRowKey;');
const $ = (selector) => w.document.querySelector(selector);
const state = w.__state;
const results = [];
const check = async (name, fn) => { try { await fn(); results.push('✅ ' + name); } catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; } };
const closeDetails = () => { $('#member-details-modal').classList.add('hidden'); };
const openRow = (page, tableId, rowIndex) => {
  w.__showPage(page);
  const row = $(`#${tableId} tr[data-row-index="${rowIndex}"]`);
  assert(row, `${page} row ${rowIndex} not found`);
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(!$('#member-details-modal').classList.contains('hidden'));
  assert($('#member-call-action a[href^="tel:"]'), 'কল button missing');
  return row;
};
const collectAndReturn = (page, tableId, rowIndex, expectedLoan) => {
  openRow(page, tableId, rowIndex);
  assert($('#btn-collect-from-balance'), `${page} আদায় button missing`);
  $('#btn-collect-from-balance').click();
  assert(!$('#today-page').classList.contains('hidden'));
  assert(!$('#btn-return-page').classList.contains('hidden'));
  assert.strictEqual($('#today-loan').value, String(expectedLoan));
  assert.strictEqual(state.todayReturnPage, page);
  $('#btn-return-page').click();
  assert.strictEqual(state.activePage, page);
  assert($('#today-page').classList.contains('hidden'));
  assert(!$(`#sec-${page}`).classList.contains('hidden'));
  assert($('#btn-return-page').classList.contains('hidden'));
};

setTimeout(async () => {
  state.identity = { role: 'admin', staff: '', label: 'Admin' };
  await check('আজ প্রতিশ্রুতি: কলের পাশে আদায় ও Return', () => collectAndReturn('today-promise', 'tbl-today-promise', 0, 1000));
  await check('আজ আদায়যোগ্য: কলের পাশে আদায় ও Return', () => collectAndReturn('payable', 'tbl-payable', 0, 1000));
  await check('বাকী কিস্তি: কলের পাশে আদায় ও Return', () => collectAndReturn('due', 'tbl-due', 0, 1000));
  await check('আংশিক কিস্তি: কলের পাশে আদায় ও Return', () => collectAndReturn('partial', 'tbl-partial', 2, 600));

  await check('একই member-এর দ্বিতীয় clicked কিস্তিই prefill ও update হয়; Return origin-এ', async () => {
    const expectedKey = w.__rowKey(state.rows[1]);
    openRow('payable', 'tbl-payable', 1);
    $('#btn-collect-from-balance').click();
    assert.strictEqual($('#today-member-code').value, '001');
    assert.strictEqual($('#today-loan').value, '500', 'প্রথম কিস্তির 1000 বসে গেছে');
    assert.strictEqual(state.todayInstallmentKey, expectedKey);
    $('#btn-add-today').click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(String(state.rows[0][5]), '0');
    assert.strictEqual(String(state.rows[1][5]), '500');
    assert.strictEqual(state.todayRows.length, 1);
    assert.strictEqual(state.todayRows[0].installmentKey, expectedKey);
    assert.strictEqual(state.todayRows[0].appliedLoan, 500);
    assert.strictEqual(state.todayInstallmentKey, '');
    $('#btn-return-page').click();
    assert.strictEqual(state.activePage, 'payable');
  });

  await check('আদায় কিস্তির details-এ কল আছে, কিন্তু এই request-এর আদায় button নেই', () => {
    openRow('paid', 'tbl-paid', 3);
    assert(!$('#btn-collect-from-balance'));
    closeDetails();
  });

  await check('Staff নিজের আংশিক কিস্তিতে আদায় + Return পায়', () => {
    state.identity = { role: 'staff', staff: 'Bob', label: 'Bob' };
    collectAndReturn('partial', 'tbl-partial', 2, 600);
  });

  await check('Manager details ও কল দেখতে পারে, আদায় button পায় না', () => {
    state.identity = { role: 'manager', staff: '', label: 'Manager' };
    openRow('due', 'tbl-due', 0);
    assert(!$('#btn-collect-from-balance'));
    closeDetails();
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 500);
