/* নিচের ২টি tab: Member List dropdown + অপরিবর্তিত Today Collection; default Today ও lazy startup। */
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
const $ = selector => w.document.querySelector(selector);
const $$ = selector => [...w.document.querySelectorAll(selector)];
const visible = selector => !$(selector).classList.contains('hidden');
const results = [];
const check = (name, fn) => { try { fn(); results.push('✅ ' + name); } catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; } };

setTimeout(() => {
  check('App open-এ default Today Collection; অন্যান্য ভারী tables lazy', () => {
    assert.strictEqual(w.__state.activePage, 'today');
    assert(visible('#today-page'));
    assert(!visible('#installment-page'));
    assert.strictEqual($('#tbl-due').querySelectorAll('tr').length, 0);
    assert.strictEqual($('#paid-archive-list').querySelectorAll('tr').length, 0);
    assert.strictEqual($('#balance-directory-list').querySelectorAll('tr').length, 0);
    assert.strictEqual($$('[data-staff-card]').length, 1);
    assert.strictEqual($$('[data-staff-entry]').length, 1);
    assert($('#today-staff-all-summary'));
    assert($('#today-member-code') && $('#today-monthly-list') && $('#today-other-list') && $('#history-card'));
  });

  check('নিচে শুধু Member List ও Today Collection—দুইটি fixed tab', () => {
    const nav = $('.page-tabs.bottom-nav.two-page-nav');
    assert(nav, 'দুই পেজের bottom navigation নেই');
    assert.deepStrictEqual($$('[data-main-page]').map(item => item.dataset.mainPage), ['members', 'today']);
    assert.deepStrictEqual($$('[data-main-page] .tab-label').map(item => item.textContent.trim()), ['Member List', 'Today Collection']);
    assert(!$('.app-menu-shell') && !$('#btn-app-menu'), 'পুরোনো floating menu এখনো আছে');
    assert.strictEqual($$('[data-menu-page]').length, 0);
    assert($('[data-main-page="today"]').classList.contains('active'));
    assert.strictEqual($('[data-main-page="today"]').getAttribute('aria-current'), 'page');
    assert(!w.document.querySelector('main').contains(nav));
  });

  check('Member List dropdown-এ সব তালিকা নির্বাচনের option আছে', () => {
    const select = $('#section-view-filter');
    assert(select && !$('.member-list-picker').classList.contains('hidden'));
    assert.deepStrictEqual([...select.options].map(option => option.value), [
      'all', 'today-promise', 'payable', 'due', 'paid', 'partial', 'balance-directory', 'paid-archive',
    ]);
  });

  const pages = [
    ['today-promise', 'sec-today-promise'], ['payable', 'sec-payable'], ['due', 'sec-due'],
    ['paid', 'sec-paid'], ['partial', 'sec-partial'], ['balance-directory', 'sec-balance-directory'], ['paid-archive', 'sec-paid-archive'],
  ];
  for (const [page, section] of pages) {
    check(`Member List dropdown → ${page}: শুধু সেই তালিকা`, () => {
      $('[data-main-page="members"]').click();
      assert(visible('#installment-page'));
      assert(!visible('#today-page'));
      const select = $('#section-view-filter');
      select.value = page;
      select.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert(visible('#' + section));
      $$('[data-sec]').forEach(item => { if (item.id !== section) assert(item.classList.contains('hidden'), item.id); });
      assert.strictEqual(w.__state.activePage, page);
      assert.strictEqual(select.value, page);
      assert($('[data-main-page="members"]').classList.contains('active'));
      assert(!$('[data-main-page="today"]').classList.contains('active'));
      assert.strictEqual($('[data-main-page="members"]').getAttribute('aria-current'), 'page');
    });
  }

  check('Today থেকে Member List-এ ফিরলে শেষ dropdown নির্বাচন থাকে', () => {
    $('[data-main-page="today"]').click();
    assert(visible('#today-page'));
    assert(!visible('#installment-page'));
    $('[data-main-page="members"]').click();
    assert(visible('#installment-page'));
    assert(visible('#sec-paid-archive'));
    assert.strictEqual(w.__state.activePage, 'paid-archive');
    assert.strictEqual($('#section-view-filter').value, 'paid-archive');
  });

  check('Member List-এর সব তালিকা (পরপর) option অপরিবর্তিত', () => {
    const select = $('#section-view-filter');
    select.value = 'all';
    select.dispatchEvent(new w.Event('change', { bubbles: true }));
    ['sec-today-promise', 'sec-due', 'sec-paid', 'sec-partial'].forEach(id => assert(visible('#' + id), id));
    assert($('[data-main-page="members"]').classList.contains('active'));
  });

  check('Saved UI-তে অন্য page থাকলেও restore default page বদলায় না', () => {
    w.localStorage.setItem(w.__uiKey, JSON.stringify({ page: 'paid', scroll: 0 }));
    w.__state.activePage = 'today';
    w.__restoreUi();
    assert.strictEqual(w.__state.activePage, 'today');
  });

  console.log(results.join('\n'));
  const failed = results.filter(line => line.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 450);
