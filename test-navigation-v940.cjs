/* v9.40: default Today, lazy startup, eight-page bottom-right menu. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const cloud = {
  updated_at: '2026-10-27T00:00:00.000Z',
  headers: ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'],
  rows: [['001', 'Due Member', 'C1', '1000', '0']], collections: [], followups: [], history: [],
  dailyData: {
    memberDBHeaders: [], memberDB: [], balanceHeaders: ['Member ID', 'Member Name', 'Loan Balance'], balanceRows: [['002', 'Balance Member', '50', 'C2']], paidArchive: [], staffDirectory: [],
    todayRows: [{ id: 't1', memberCode: '999', memberName: 'Today Member', centerCode: 'C9', ownerStaff: 'Alice', loan: 25, savings: 5, dps: 0, total: 30, installmentKey: '', date: '2026-10-27' }],
  },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://navigation.test/', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.localStorage.setItem('collectionManager.identity.v1', JSON.stringify({ role: 'admin', staff: '', label: 'Admin' }));
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + '\n;window.__state=state;window.__restoreUi=restoreUiState;window.__uiKey=UI_STATE_KEY;');
const $ = (selector) => w.document.querySelector(selector);
const $$ = (selector) => [...w.document.querySelectorAll(selector)];
const visible = (selector) => !$(selector).classList.contains('hidden');
const results = [];
const check = (name, fn) => { try { fn(); results.push('✅ ' + name); } catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; } };

setTimeout(() => {
  check('App open-এ default Today All Collection; অন্যান্য ভারী tables lazy', () => {
    assert.strictEqual(w.__state.activePage, 'today');
    assert(visible('#today-page'));
    assert(!visible('#installment-page'));
    assert.strictEqual($('#tbl-due').querySelectorAll('tr').length, 0);
    assert.strictEqual($('#paid-archive-list').querySelectorAll('tr').length, 0);
    assert.strictEqual($('#balance-directory-list').querySelectorAll('tr').length, 0);
    assert.strictEqual($$('[data-staff-card]').length, 1);
    assert.strictEqual($$('[data-staff-entry]').length, 1);
    assert($('#today-staff-all-summary'));
  });

  check('Three-line menu-তে Today + সাতটি আলাদা logical page; পুরোনো দুই tab নেই', () => {
    assert.strictEqual($$('[data-menu-page]').length, 8);
    assert(!$('.page-tabs.bottom-nav'));
    assert.strictEqual($('#btn-app-menu').querySelectorAll('.app-menu-line').length, 3);
  });

  const pages = [
    ['today-promise', 'sec-today-promise'], ['payable', 'sec-payable'], ['due', 'sec-due'],
    ['paid', 'sec-paid'], ['partial', 'sec-partial'], ['balance-directory', 'sec-balance-directory'], ['paid-archive', 'sec-paid-archive'],
  ];
  for (const [page, section] of pages) {
    check(`Menu → ${page}: শুধু সেই table page দেখা যায়`, () => {
      $('#btn-app-menu').click();
      assert(visible('#app-menu-panel'));
      $(`[data-menu-page="${page}"]`).click();
      assert(!visible('#app-menu-panel'));
      assert(!visible('#today-page'));
      assert(visible('#installment-page'));
      assert(visible('#' + section));
      $$('[data-sec]').forEach((item) => { if (item.id !== section) assert(item.classList.contains('hidden'), item.id); });
      assert.strictEqual(w.__state.activePage, page);
      assert($(`[data-menu-page="${page}"]`).classList.contains('active'));
    });
  }

  check('Return-এর উপর নির্ভর না করে menu থেকে Today-তে ফেরত যাওয়া যায়', () => {
    w.__state.todayReturnPage = 'balance-directory';
    $('#btn-app-menu').click();
    $('[data-menu-page="today"]').click();
    assert(visible('#today-page'));
    assert(!visible('#installment-page'));
    assert.strictEqual(w.__state.activePage, 'today');
  });

  check('Saved UI-তে অন্য page থাকলেও restore default page বদলায় না', () => {
    w.localStorage.setItem(w.__uiKey, JSON.stringify({ page: 'paid', scroll: 0 }));
    w.__state.activePage = 'today';
    w.__restoreUi();
    assert.strictEqual(w.__state.activePage, 'today');
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 450);
