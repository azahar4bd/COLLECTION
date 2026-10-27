/* Main lists: one page scroll, no list descriptions, and edit-safe prevActual baseline. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const entry = (id, memberCode, memberName, loan, savings, prevActual, appliedLoan, installmentKey) => ({
  id, memberCode, centerCode: '001', memberName, loan, savings, dps: 0, total: loan + savings,
  date: '2026-10-24', createdAt: `2026-10-24T01:00:0${id.length}.000Z`, installmentKey,
  prevActual, appliedLoan, ownerStaff: 'Alice', ownerRole: 'staff', ownerDevice: 'test',
});
const cloud = {
  headers,
  rows: [
    ['0001', 'Due Member', '001', 'Alice', '1000', '1000'],
    ['0002', 'Partial Member', '001', 'Alice', '1000', '150'],
    ['0003', 'Savings Member', '001', 'Alice', '1000', '0'],
  ],
  collections: [], followups: [], history: [],
  dailyData: {
    memberDBHeaders: ['Member Code', 'Member Name', 'Center Code'],
    memberDB: [['0001', 'Due Member', '001'], ['0002', 'Partial Member', '001'], ['0003', 'Savings Member', '001']],
    balanceHeaders: [], balanceRows: [], paidArchive: [], staffDirectory: [],
    todayRows: [
      entry('a', '0001', 'Due Member', 1000, 0, '0', 1000, 'key-a'),
      entry('bb', '0002', 'Partial Member', 50, 0, '100', 50, 'key-b'),
      entry('ccc', '0003', 'Savings Member', 0, 25, '', 0, 'key-c'),
      entry('dddd', '9999', 'Other Member', 0, 10, '', 0, ''),
    ],
  },
};
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const w = new JSDOM(html, {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.fetch = async (url, options = {}) => ({
  ok: true, status: 200,
  json: async () => options.method ? { ok: true, updated_at: new Date().toISOString() } : cloud,
});
w.eval(fs.readFileSync('app.js', 'utf8') + `\n;window.__state = state;
window.__renderToday = renderToday;
window.__startEdit = startEditToday;
window.__add = addTodayRow;
`);
const $ = (selector) => w.document.querySelector(selector);
const state = w.__state;
setTimeout(async () => {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push('✅ ' + name); }
    catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
  };
  await check('Origin counter heading-style label ও badge; অন্য list বর্ণনা বাদ', async () => {
    const origin = $('#today-monthly-origin');
    assert(origin);
    assert(origin.textContent.includes('বাকী কিস্তি থেকে আদায়'), origin.textContent);
    assert(origin.textContent.includes('আংশিক কিস্তি থেকে আদায়'), origin.textContent);
    assert.strictEqual($('#today-origin-due').textContent, '১');
    assert.strictEqual($('#today-origin-partial').textContent, '১');
    assert($('#today-origin-due').classList.contains('badge'));
    assert($('#today-origin-partial').classList.contains('badge'));
    assert(!$('#payable-note'));
    assert(!$('.today-sub-note'));
    assert(!$('.history-head .hint'));
    assert(!$('#sec-paid-archive .paid-archive-panel .hint'));
    assert.strictEqual($('#count-today-monthly').textContent, '৩');
    assert.strictEqual($('#count-today-other').textContent, '১');
  });
  await check('সব money cell-এ English অঙ্ক; count Bengali ও data অপরিবর্তিত', async () => {
    const moneyCells = [...w.document.querySelectorAll('.table-card td.amt')];
    assert(moneyCells.length > 0);
    for (const cell of moneyCells) assert(!/[০-৯]/.test(cell.textContent), cell.textContent);
    const first = $('#today-monthly-list tr.today-row');
    assert.strictEqual(first.cells[4].textContent, '1,000');
    assert.strictEqual(first.cells[7].textContent, '৳ 1,000');
    assert.strictEqual($('#count-today-monthly').textContent, '৩');
  });
  await check('Vertical শুধু page scroll; table-এর horizontal scroll অনুমোদিত', async () => {
    const compact = css.slice(css.lastIndexOf('/* ===== v9.29'));
    assert(compact.includes('max-height: none'));
    assert(compact.includes('overflow-x: auto'));
    assert(compact.includes('overflow-y: hidden'));
    assert(!compact.includes('--standard-list-height'));
  });
  await check('পুরোনো readable font ও পূর্ণ নাম; ellipsis/word break নেই', async () => {
    const tableCss = css.slice(css.lastIndexOf('/* ===== v9.29'));
    assert(tableCss.includes('font-size: 14px'));
    assert(tableCss.includes('width: max-content'));
    assert(tableCss.includes('table-layout: auto'));
    assert(tableCss.includes('white-space: nowrap'));
    assert(tableCss.includes('text-overflow: clip'));
    assert(tableCss.includes('overflow-wrap: normal'));
    assert(!tableCss.includes('text-overflow: ellipsis'));
    assert(!tableCss.includes('font-size: 8.5px'));
    assert(!tableCss.includes('overflow-wrap: anywhere'));
    assert(!tableCss.includes('overflow-wrap: break-word'));
    assert(!tableCss.includes('display: grid'));
    assert(!tableCss.includes('td::before'));
    assert(!fs.readFileSync('app.js', 'utf8').includes('syncResponsiveTableLabels'));
    const row = $('#today-monthly-list tr.today-row');
    assert.strictEqual(row.cells.length, 9);
    assert.strictEqual($('#today-monthly-list tr.today-center-total td').colSpan, 4);
  });
  await check('Due entry edit-এর পরও prevActual=0 এবং save অক্ষত', async () => {
    const index = state.todayRows.findIndex((item) => item.id === 'a');
    w.__startEdit(index);
    $('#today-loan').value = '600';
    $('#today-savings').value = '0';
    $('#today-dps').value = '0';
    $('#today-total').value = '600';
    await w.__add();
    const edited = state.todayRows.find((item) => item.id === 'a');
    assert.strictEqual(Number(edited.prevActual), 0, edited.prevActual);
    assert.strictEqual(state.rows[0][5], '600');
    assert.strictEqual($('#count-today-monthly').textContent, '৩');
    assert.strictEqual($('#today-origin-due').textContent, '১');
    assert.strictEqual($('#today-origin-partial').textContent, '১');
  });
  await check('Monthly entry না থাকলে origin দুই badge-ই শূন্য', async () => {
    state.todayRows = state.todayRows.filter((item) => item.memberName === 'Other Member');
    w.__renderToday();
    assert.strictEqual($('#count-today-monthly').textContent, '০');
    assert.strictEqual($('#count-today-other').textContent, '১');
    assert.strictEqual($('#today-origin-due').textContent, '০');
    assert.strictEqual($('#today-origin-partial').textContent, '০');
    assert.strictEqual($('#today-monthly-total-loan').textContent, '0');
    assert.strictEqual($('#today-monthly-total-total').textContent, '৳ 0');
  });
  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 700);
