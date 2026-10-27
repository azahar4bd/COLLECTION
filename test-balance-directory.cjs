/* অন্যান্য সদস্য তালিকা: global staff/center/search filters, details, আদায় ও Return. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const headers = ['Member Code', 'Member Name', 'Center Code', 'Center Name', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['001', 'Monthly One', 'C1', 'Center One', 'Alice', '1000', '0'],
  ['999', 'Monthly Name', 'C3', 'Center Three', 'Alice', '1000', '0'],
];
const cloud = {
  updated_at: '2026-10-26T00:00:00.000Z', headers, rows, collections: [], followups: [], history: [],
  dailyData: {
    memberDBHeaders: ['Member No', 'Member Name', 'Center Code & Name', 'Staff Name', 'Mobile'],
    memberDB: [
      ['001', 'Monthly One', 'C1, Center One', 'Alice', '01700000001'],
      ['002', 'Other Two', 'C1, Center One', 'Alice', '01700000002'],
      ['003', 'Other Three', 'C2, Center Two', 'Bob', '01700000003'],
      ['004', 'Zero Four', 'C2, Center Two', 'Bob', '01700000004'],
      ['005', 'Monthly Name', 'C3, Center Three', 'Alice', '01700000005'],
    ],
    balanceHeaders: ['Member ID', 'Member Name', 'Savings Balance', 'DPS Balance', 'Loan Balance'],
    balanceRows: [
      ['001', 'Monthly One', '10', '1', '100', 'C1'],
      ['002', 'Other Two', '20', '2', '200', 'C1'],
      ['003', 'Other Three', '30', '3', '300', 'C2'],
      ['004', 'Zero Four', '0', '0', '0', 'C2'],
      ['005', 'Monthly Name', '50', '5', '500', 'C3'],
      ['006', 'No Directory', '40', '4', '0', 'C2'],
    ],
    todayRows: [], paidArchive: [], staffDirectory: [
      { name: 'Alice', members: ['001', '002', '005'], centers: [] },
      { name: 'Bob', members: ['003', '004'], centers: [] },
    ],
  },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://balance.test/', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.fetch = async (url, options = {}) => ({ ok: true, status: 200, json: async () => options.method === 'POST' ? { ok: true, updated_at: cloud.updated_at } : cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + '\n;window.__state=state;window.__renderBalance=renderBalanceDirectory;window.__applySection=applySectionView;window.__showPage=showPage;window.__openBalance=openBalanceMemberDetails;');
const $ = (selector) => w.document.querySelector(selector);
const results = [];
const check = (name, fn) => { try { fn(); results.push('✅ ' + name); } catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; } };
const text = (selector) => $(selector).textContent.trim();
const search = (value, key = 'memberCode') => {
  const select = $('#f-search-key');
  if (select.value !== key) { select.value = key; select.dispatchEvent(new w.Event('change', { bubbles: true })); }
  const input = $('#f-member'); input.value = value; input.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const choose = (selector, value) => { const select = $(selector); assert([...select.options].some((option) => option.value === value), `Missing option ${value}`); select.value = value; select.dispatchEvent(new w.Event('change', { bubbles: true })); };
const clear = () => $('#btn-clear-filters').click();
const rowCount = () => $('#balance-directory-list').querySelectorAll('tr.balance-directory-row').length;
const centerCount = () => $('#balance-directory-list').querySelectorAll('.balance-center-group').length;
const assertAll = () => {
  assert.strictEqual(rowCount(), 3); assert.strictEqual(centerCount(), 2);
  assert.strictEqual($('#f-staff').value, ''); assert.strictEqual($('#f-center').value, ''); assert.strictEqual($('#f-member').value, '');
};

setTimeout(() => {
  w.__state.identity = { role: 'admin', staff: '', label: 'Admin' };
  w.__showPage('balance-directory');

  check('Screenshot-style global filters; default-এ সব staff/center এবং আলাদা internal dropdown নেই', () => {
    assert(!$('.balance-directory-filters'));
    assert(!$('#balance-filter-all')); assert(!$('#balance-search-all'));
    for (const selector of ['#f-staff', '#f-center', '#f-search-key', '#f-member', '#btn-clear-filters']) assert($(selector), selector);
    assert(!$('.filter-bar').classList.contains('hidden'));
    const centerValues = [...$('#f-center').options].map((option) => option.value).filter(Boolean);
    assert.deepStrictEqual(centerValues.sort(), ['C1', 'C2']);
    assert([...$('#f-staff').options].some((option) => option.value === 'Alice'));
    assert([...$('#f-staff').options].some((option) => option.value === 'Bob'));
    assertAll();
    const headersText = [...$('#balance-directory-list').querySelectorAll('.balance-center-header')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
    assert(headersText.some((line) => line.includes('Center One') && line.includes('C1')));
    assert(headersText.some((line) => line.includes('Center Two') && line.includes('C2')));
    assert.strictEqual(text('#balance-total-total'), '৳ 599');
    assert.strictEqual(text('#sec-balance-directory .th-title').includes('অন্যান্য সদস্য তালিকা'), true);
  });

  check('Monthly code/name match ও zero balance বাদ', () => {
    const tableText = $('#balance-directory-list').textContent;
    assert(!tableText.includes('Monthly One'));
    assert(!tableText.includes('Monthly Name'));
    assert(!tableText.includes('Zero Four'));
    assert(tableText.includes('Other Two'));
    assert(tableText.includes('No Directory'));
    assert.strictEqual(text('#balance-total-loan'), '500');
    assert.strictEqual(text('#balance-total-savings'), '90');
    assert.strictEqual(text('#balance-total-dps'), '9');
  });

  check('Staff + center dropdown এবং Clear সঠিকভাবে filter করে', () => {
    choose('#f-staff', 'Alice');
    assert.strictEqual(rowCount(), 1); assert.strictEqual(text('#balance-total-total'), '৳ 222');
    clear(); assertAll();
    choose('#f-staff', 'Bob');
    assert.strictEqual(rowCount(), 1); assert.strictEqual(text('#balance-total-total'), '৳ 333');
    choose('#f-center', 'C1');
    assert.strictEqual(rowCount(), 0);
    clear(); assertAll();
    choose('#f-center', 'C2');
    assert.strictEqual(rowCount(), 2); assert.strictEqual(centerCount(), 1); assert.strictEqual(text('#balance-total-total'), '৳ 377');
    clear(); assertAll();
  });

  check('Search-type: member code/Bengali digits, center code ও member name', () => {
    search('002'); assert.strictEqual(rowCount(), 1);
    search('০০২'); assert.strictEqual(rowCount(), 1); assert.strictEqual(text('#balance-total-total'), '৳ 222');
    clear();
    search('C2', 'centerCode'); assert.strictEqual(rowCount(), 2); assert.strictEqual(centerCount(), 1);
    clear();
    search('Other Three', 'memberName'); assert.strictEqual(rowCount(), 1); assert.strictEqual(text('#balance-total-total'), '৳ 333');
    search('Other', 'memberName'); assert.strictEqual(rowCount(), 2);
    search('কোনো তথ্য নেই', 'memberName'); assert.strictEqual(rowCount(), 0);
    assert(!$('#balance-directory-empty').classList.contains('hidden'));
    clear(); assertAll();
  });

  check('Stale appended center হলে directory-র সঠিক center ব্যবহার হয়', () => {
    const centerCell = w.__state.balanceHeaders.length;
    const previous = w.__state.balanceRows[2][centerCell];
    try {
      w.__state.balanceRows[2][centerCell] = 'C1';
      w.__showPage('balance-directory');
      choose('#f-center', 'C2');
      assert.strictEqual(rowCount(), 2); assert.strictEqual(text('#balance-total-total'), '৳ 377');
      clear(); assertAll();
    } finally {
      w.__state.balanceRows[2][centerCell] = previous;
      w.__showPage('balance-directory');
      assertAll();
    }
  });

  check('Center-wise subtotal সঠিক', () => {
    const totals = [...$('#balance-directory-list').querySelectorAll('tr.balance-center-total')].map((row) => row.textContent.replace(/\s+/g, ' ').trim());
    assert(totals.some((line) => line.includes('C1') && line.includes('200') && line.includes('20') && line.includes('222')));
    assert(totals.some((line) => line.includes('C2') && line.includes('300') && line.includes('70') && line.includes('377')));
  });

  check('Member details-এ কল + পাশে আদায়; Today prefill ও Return originating page-এ', () => {
    const row = [...documentRows()].find((item) => item.textContent.includes('Other Two'));
    assert(row);
    row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert(!$('#member-details-modal').classList.contains('hidden'));
    assert($('#member-call-action a[href^="tel:"]'));
    assert($('#btn-collect-from-balance'));
    assert.strictEqual($('#member-call-action').nextElementSibling.id, 'member-collection-action');
    $('#btn-collect-from-balance').click();
    assert(!$('#today-page').classList.contains('hidden'));
    assert($('#installment-page').classList.contains('hidden'));
    assert.strictEqual($('#today-member-code').value, '002');
    assert.strictEqual($('#today-member-name').value, 'Other Two');
    assert(!$('#btn-return-page').classList.contains('hidden'));
    $('#btn-return-page').click();
    assert(!$('#sec-balance-directory').classList.contains('hidden'));
    assert($('#today-page').classList.contains('hidden'));
    assert($('#btn-return-page').classList.contains('hidden'));
    assertAll();
  });

  check('Manager details দেখতে ও কল করতে পারে, কিন্তু আদায় button পায় না', () => {
    w.__state.identity = { role: 'manager', staff: '', label: 'Manager' };
    w.__openBalance(1);
    assert($('#member-call-action a[href^="tel:"]'));
    assert(!$('#btn-collect-from-balance'));
    w.__state.identity = { role: 'admin', staff: '', label: 'Admin' };
  });

  check('অন্যান্য সদস্য তালিকা ও স্থায়ী আদায় আর্কাইভ আলাদা page', () => {
    w.__showPage('balance-directory');
    assert(!$('#sec-balance-directory').classList.contains('hidden'));
    assert(!$('#sec-balance-directory').classList.contains('collapsed'));
    assert($('#sec-paid-archive').classList.contains('hidden'));
    w.__showPage('paid-archive');
    assert($('#sec-balance-directory').classList.contains('hidden'));
    assert(!$('#sec-paid-archive').classList.contains('hidden'));
    const children = [...$('#installment-page').children];
    assert(children.indexOf($('#sec-balance-directory')) < children.indexOf($('#sec-paid-archive')));
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 500);

function documentRows() { return w.document.querySelectorAll('#balance-directory-list tr.balance-directory-row'); }
