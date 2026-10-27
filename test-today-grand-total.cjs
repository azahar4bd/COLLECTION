/* Today: active staff-এর member-entry tables + final all-staff summary + role visibility. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const headers = ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'];
const rows = [['001', 'Monthly One', 'C1', '1000', '0'], ['002', 'Monthly Two', 'C2', '1000', '0']];
const entry = (id, memberCode, memberName, centerCode, ownerStaff, loan, savings, dps, installmentKey) => ({
  id, memberCode, memberName, centerCode, ownerStaff, ownerRole: 'staff', loan, savings, dps,
  total: loan + savings + dps, installmentKey, date: '2026-10-25', createdAt: '2026-10-25T00:00:00.000Z',
});
const cloud = {
  updated_at: '2026-10-25T00:00:00.000Z', headers, rows, collections: [], followups: [], history: [],
  dailyData: {
    memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], paidArchive: [], staffDirectory: [],
    todayRows: [
      entry('m1', '001', 'Monthly One', 'C1', 'Alice', 100, 20, 5, 'installment-1'),
      entry('m2', '002', 'Monthly Two', 'C2', 'Bob', 200, 0, 10, 'installment-2'),
      entry('o1', '999', 'Other Member', 'C9', 'Alice', 50, 10, 0, ''),
    ],
  },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.fetch = async (url, options = {}) => ({ ok: true, status: 200, json: async () => options.method === 'POST' ? { ok: true, updated_at: cloud.updated_at } : cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + '\n;window.__state=state;window.__render=renderToday;');
const $ = (selector) => w.document.querySelector(selector);
const $$ = (selector) => [...w.document.querySelectorAll(selector)];
const state = w.__state;
const results = [];
const check = (name, fn) => { try { fn(); results.push('✅ ' + name); } catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; } };
const amount = (selector) => $(selector).textContent.trim();
const cells = (selectorOrRow) => [...(typeof selectorOrRow === 'string' ? $(selectorOrRow) : selectorOrRow).cells].map((cell) => cell.textContent.trim());
const expectAmounts = (loan, savings, dps, total) => {
  assert.strictEqual(amount('#today-grand-loan'), String(loan));
  assert.strictEqual(amount('#today-grand-savings'), String(savings));
  assert.strictEqual(amount('#today-grand-dps'), String(dps));
  assert.strictEqual(amount('#today-grand-total'), `৳ ${total}`);
};

setTimeout(() => {
  check('Admin/Manager: existing category ও combined totals অপরিবর্তিত', () => {
    state.identity = { role: 'admin', staff: '', label: 'Admin' };
    w.__render();
    expectAmounts('350', '30', '15', '395');
    assert.strictEqual(amount('#today-monthly-total-loan'), '300');
    assert.strictEqual(amount('#today-monthly-total-savings'), '20');
    assert.strictEqual(amount('#today-monthly-total-dps'), '15');
    assert.strictEqual(amount('#today-other-total-loan'), '50');
    assert.strictEqual(amount('#today-other-total-savings'), '10');
    assert.strictEqual(amount('#today-other-total-dps'), '0');
    assert.strictEqual(amount('#today-monthly-total-total'), '৳ 335');
    assert.strictEqual(amount('#today-other-total-total'), '৳ 60');
  });

  check('প্রতি active staff: member-entry rows + মাসিক/অন্যান্য/সর্বমোট; শেষে সকল স্টাফ সর্বমোট', () => {
    const cards = $$('[data-staff-card]');
    assert.strictEqual(cards.length, 2);
    const alice = $('[data-staff-card="Alice"]'), bob = $('[data-staff-card="Bob"]');
    assert(alice && bob);
    assert.strictEqual(alice.querySelectorAll('[data-staff-entry]').length, 2);
    assert.strictEqual(bob.querySelectorAll('[data-staff-entry]').length, 1);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-entry="0"]')), ['001', 'C1', 'Monthly One', 'মাসিক', '100', '20', '5', '৳ 125']);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-entry="2"]')), ['999', 'C9', 'Other Member', 'অন্যান্য', '50', '10', '0', '৳ 60']);
    assert.deepStrictEqual(cells(bob.querySelector('[data-staff-entry]')), ['002', 'C2', 'Monthly Two', 'মাসিক', '200', '0', '10', '৳ 210']);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-total="monthly"]')), ['মাসিক মোট', '100', '20', '5', '৳ 125']);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-total="other"]')), ['অন্যান্য মোট', '50', '10', '0', '৳ 60']);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-total="combined"]')), ['সর্বমোট', '150', '30', '5', '৳ 185']);
    assert.deepStrictEqual(cells(bob.querySelector('[data-staff-total="combined"]')), ['সর্বমোট', '200', '0', '10', '৳ 210']);
    const all = $('#today-staff-all-summary');
    assert(all);
    assert.strictEqual(all, $('#today-staff-groups').lastElementChild);
    assert.deepStrictEqual(cells(all.querySelector('[data-all-staff="monthly"]')), ['মাসিক', '300', '20', '15', '৳ 335']);
    assert.deepStrictEqual(cells(all.querySelector('[data-all-staff="other"]')), ['অন্যান্য', '50', '10', '0', '৳ 60']);
    assert.deepStrictEqual(cells(all.querySelector('[data-all-staff="combined"]')), ['মাসিক + অন্যান্য', '350', '30', '15', '৳ 395']);
    assert(!$('.today-staff-matrix'));
    expectAmounts('350', '30', '15', '395');
  });

  check('চার staff আদায় করলে ঠিক চারটি non-empty staff table; empty staff table নয়', () => {
    const original = [...state.todayRows];
    try {
      state.todayRows.push(entry('o2', '998', 'Carol Member', 'C8', 'Carol', 10, 0, 0, ''));
      state.todayRows.push(entry('o3', '997', 'David Member', 'C7', 'David', 0, 15, 0, ''));
      w.__render();
      const cards = $$('[data-staff-card]');
      assert.strictEqual(cards.length, 4);
      assert.deepStrictEqual(cards.map((card) => card.dataset.staffCard), ['Alice', 'Bob', 'Carol', 'David']);
      cards.forEach((card) => assert(card.querySelectorAll('[data-staff-entry]').length > 0));
      assert.strictEqual($$('[data-staff-entry]').length, 5);
      assert($('#today-staff-all-summary'));
    } finally {
      state.todayRows = original;
      w.__render();
    }
  });

  check('Staff role: শুধু নিজের member-entry table ও নিজের visible all-staff total', () => {
    state.identity = { role: 'staff', staff: 'Alice', label: 'Alice' };
    w.__render();
    expectAmounts('150', '30', '5', '185');
    assert.strictEqual($$('[data-staff-card]').length, 1);
    assert($('[data-staff-card="Alice"]'));
    assert(!$('[data-staff-card="Bob"]'));
    assert.strictEqual($$('[data-staff-entry]').length, 2);
    assert.deepStrictEqual(cells('#today-staff-all-summary [data-all-staff="combined"]'), ['মাসিক + অন্যান্য', '150', '30', '5', '৳ 185']);
    state.identity = { role: 'staff', staff: 'Bob', label: 'Bob' };
    w.__render();
    expectAmounts('200', '0', '10', '210');
    assert.strictEqual($$('[data-staff-card]').length, 1);
    assert($('[data-staff-card="Bob"]'));
    assert.strictEqual($$('[data-staff-entry]').length, 1);
    assert.deepStrictEqual(cells('#today-staff-all-summary [data-all-staff="combined"]'), ['মাসিক + অন্যান্য', '200', '0', '10', '৳ 210']);
  });

  check('Entry update করলে member row, staff totals, সকল স্টাফ ও existing total বদলায়', () => {
    state.identity = { role: 'admin', staff: '', label: 'Admin' };
    const other = state.todayRows.find((item) => item.id === 'o1');
    other.loan = 70; other.total = 80;
    w.__render();
    expectAmounts('370', '30', '15', '415');
    const alice = $('[data-staff-card="Alice"]');
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-entry="2"]')).slice(4), ['70', '10', '0', '৳ 80']);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-total="other"]')), ['অন্যান্য মোট', '70', '10', '0', '৳ 80']);
    assert.deepStrictEqual(cells(alice.querySelector('[data-staff-total="combined"]')), ['সর্বমোট', '170', '30', '5', '৳ 205']);
    assert.deepStrictEqual(cells('#today-staff-all-summary [data-all-staff="combined"]'), ['মাসিক + অন্যান্য', '370', '30', '15', '৳ 415']);
  });

  check('Empty Today-তে কোনো staff/all-staff table নয় এবং সব total শূন্য', () => {
    state.todayRows = [];
    w.__render();
    expectAmounts('0', '0', '0', '0');
    assert.strictEqual($$('[data-staff-card]').length, 0);
    assert(!$('#today-staff-all-summary'));
    assert(!$('#today-staff-empty').classList.contains('hidden'));
  });

  check('Existing combined table-এর headers ও স্থান ঠিক; money digits English', () => {
    const summary = $('#today-grand-summary');
    const summaryHeaders = [...summary.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
    assert.deepStrictEqual(summaryHeaders, ['ক্যাটাগরি', 'লোন', 'সঞ্চয়', 'DPS', 'মোট']);
    assert(!$('#today-grand-monthly'));
    assert(!$('#today-grand-other'));
    const children = [...$('#today-page').children];
    const otherCard = $('#today-other-list').closest('.today-table-card');
    assert(children.indexOf(summary) > children.indexOf(otherCard));
    for (const cell of summary.querySelectorAll('td.amt')) assert(!/[০-৯]/.test(cell.textContent));
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 400);
