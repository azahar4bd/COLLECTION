/* নতুন ফিচার যাচাই: শেষ ৪/৩ সংখ্যা, A→Z সাজানো, প্রতিশ্রুতি-তারিখ সার্চ,
   ষ্টাফ-নির্ভর সেন্টার তালিকা, আদায় রিসেট, তালিকা-ভিউ ফিল্টার। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const yday = new Date(now.getTime() - 86400000);
const yesterday = `${yday.getFullYear()}-${pad(yday.getMonth() + 1)}-${pad(yday.getDate())}`;

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['0000123', 'Zara Member', '101', 'Collector A', '1000', '0'],
  ['0000456', 'Alpha Member', '102', 'Collector A', '1000', '0'],
  ['0000789', 'Beta Member', '103', 'Collector B', '1000', '0'],
  ['0000999', 'Gamma Member', '101', 'Collector B', '1000', '0'],
];

const cloud = {
  headers, rows, collections: [],
  followups: [
    { key: 'code:123', memberCode: '0000123', memberName: 'Zara Member', promise: 'আজ টাকা দেব', nextDate: today, givenDate: today, updatedAt: new Date().toISOString() },
    { key: 'code:456', memberCode: '0000456', memberName: 'Alpha Member', promise: 'আগামীকাল দেব', nextDate: yesterday, givenDate: yesterday, updatedAt: yday.toISOString() },
  ],
  dailyData: { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__showPage = showPage;
window.__renderMemberDatabaseTable = renderMemberDatabaseTable;
window.__displayMemberCode = displayMemberCode;
window.__displayCenterCode = displayCenterCode;
window.__compareAZ = compareAZ;
window.__updateSearchMode = updateInstallmentSearchMode;
`);

const $ = (sel) => w.document.querySelector(sel);
const $$ = (sel) => [...w.document.querySelectorAll(sel)];

setTimeout(() => {
  // New pages render lazily; this legacy multi-table suite explicitly opens the all-tables view.
  w.__showPage('installments');
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };

  check('মেম্বার কোড শেষের ৪ সংখ্যা, সেন্টার কোড শেষের ৩ সংখ্যা (কিস্তি টেবিল)', () => {
    const table = w.document.querySelector('#tbl-due');
    const cells = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    const zara = cells.find((r) => r.includes('Zara Member'));
    assert(zara, 'Zara সারি পাওয়া যায়নি');
    assert.strictEqual(zara[0], '0123', `মেম্বার কোড = ${zara[0]}`);
    assert.strictEqual(zara[2], '101', `সেন্টার কোড = ${zara[2]}`);
  });

  check('কিস্তি টেবিল A→Z (ছোট থেকে বড়) সাজানো', () => {
    const codes = $$('#tbl-due tr').map((tr) => tr.querySelector('td').textContent.trim());
    assert.deepStrictEqual(codes, ['0123', '0456', '0789', '0999'], codes.join(','));
  });

  check('প্রতিশ্রুতির তারিখ দিয়ে সার্চ (সার্চ-ড্রপডাউনে অপশন আছে)', () => {
    const sel = $('#f-search-key');
    assert([...sel.options].some((o) => o.value === 'promiseDate'), 'অপশন নেই');
    sel.value = 'promiseDate';
    sel.dispatchEvent(new w.Event('change'));
    assert.strictEqual($('#f-member').type, 'date', 'সার্চ বক্স ডেট ইনপুটে পরিবর্তন হয়নি');
    $('#f-member').value = today;
    $('#f-member').dispatchEvent(new w.Event('input'));
    const names = $$('#tbl-due tr').map((tr) => tr.textContent);
    assert(names.some((t) => t.includes('Zara Member')), 'আজকের প্রতিশ্রুতি পাওয়া যায়নি');
    assert(!names.some((t) => t.includes('Alpha Member')), 'গতকালের প্রতিশ্রুতি ভুল করে এসেছে');
  });

  check('মেম্বার/সেন্টার কোড বাছলে numeric কীবোর্ড, নাম বাছলে সাধারণ কীবোর্ড', () => {
    const sel = $('#f-search-key'), input = $('#f-member');
    sel.value = 'memberCode';
    w.__updateSearchMode();
    assert.strictEqual(input.getAttribute('inputmode'), 'numeric', `memberCode → ${input.getAttribute('inputmode')}`);
    assert.ok(/মেম্বার কোড/.test(input.placeholder), `placeholder = ${input.placeholder}`);
    sel.value = 'centerCode';
    w.__updateSearchMode();
    assert.strictEqual(input.getAttribute('inputmode'), 'numeric', `centerCode → ${input.getAttribute('inputmode')}`);
    assert.ok(/সেন্টার কোড/.test(input.placeholder), `placeholder = ${input.placeholder}`);
    sel.value = 'memberName';
    w.__updateSearchMode();
    assert.strictEqual(input.getAttribute('inputmode'), 'text', `memberName → ${input.getAttribute('inputmode')}`);
    assert.ok(/নাম/.test(input.placeholder), `placeholder = ${input.placeholder}`);
    sel.value = 'promiseDate';
    w.__updateSearchMode();
    assert.strictEqual(input.type, 'date', 'তারিখ মোডে type=date নয়');
    sel.value = 'memberCode';
    w.__updateSearchMode();
  });

  check('সার্চ মুছলে সব সারি ফিরে আসে', () => {
    $('#btn-clear-filters').click();
    assert.strictEqual($$('#tbl-due tr').length, 4, 'সারি সংখ্যা ঠিক নেই');
    assert.strictEqual($('#f-member').type, 'search', 'সার্চ বক্সের ধরন ফিরে আসেনি');
  });

  check('ষ্টাফ সিলেক্ট করলে সেন্টার তালিকায় শুধু ওই ষ্টাফের সেন্টার', () => {
    const staff = $('#f-staff');
    const values = [...staff.options].map((o) => o.value);
    assert(values.includes('Collector A') && values.includes('Collector B'), 'ষ্টাফ অপশন নেই');
    staff.value = 'Collector A';
    staff.dispatchEvent(new w.Event('change'));
    const centers = [...$('#f-center').options].map((o) => o.value);
    assert.deepStrictEqual(centers.filter(Boolean), ['101', '102'], centers.join(','));
    const center = $('#f-center');
    center.value = '102';
    center.dispatchEvent(new w.Event('change'));
    assert.strictEqual($$('#tbl-due tr').length, 1, 'সেন্টার ফিল্টার কাজ করেনি');
    $('#btn-clear-filters').click();
  });

  check('তালিকা-ভিউ ফিল্টার: শুধু আজ প্রতিশ্রুতি', () => {
    const view = $('#section-view-filter');
    assert(view, 'ভিউ ফিল্টার নেই');
    view.value = 'today-promise';
    view.dispatchEvent(new w.Event('change'));
    assert(!$('#sec-today-promise').classList.contains('hidden'), 'আজ প্রতিশ্রুতি লুকানো');
    assert($('#sec-due').classList.contains('hidden'), 'বাকী কিস্তি লুকানো হয়নি');
    assert($('#sec-paid').classList.contains('hidden'), 'আদায় কিস্তি লুকানো হয়নি');
    assert($('#sec-partial').classList.contains('hidden'), 'আংশিক কিস্তি লুকানো হয়নি');
  });

  check('তালিকা-ভিউ ফিল্টার: সব তালিকা পরপর', () => {
    const view = $('#section-view-filter');
    view.value = 'all';
    view.dispatchEvent(new w.Event('change'));
    ['sec-today-promise', 'sec-due', 'sec-paid', 'sec-partial'].forEach((id) => {
      assert(!$('#' + id).classList.contains('hidden'), id + ' লুকানো');
    });
  });

  check('আদায় তালিকা পেজ বাদ — Today All Collection পেজে ২টা টেবিল (মাসিক + অন্যান্য)', () => {
    assert(!$('#collections-page'), 'পুরোনো আদায় তালিকা পেজ এখনো আছে');
    assert(!w.document.querySelector('[data-page="collections"]'), 'আদায় তালিকা ট্যাব এখনো আছে');
    assert($('#today-monthly-list'), 'মাসিক টেবিল নেই');
    assert($('#today-other-list'), 'অন্যান্য টেবিল নেই');
  });

  check('কিস্তি তালিকায় "আদায় নিন" বাটন আর নেই', () => {
    assert.strictEqual(w.document.querySelectorAll('[data-collect-index]').length, 0, 'আদায় বাটন এখনো আছে');
  });

  check('আজ আদায়যোগ্য টেবিল আজ প্রতিশ্রুতি ও বাকী কিস্তির মাঝে', () => {
    const promise = $('#sec-today-promise'), payable = $('#sec-payable'), due = $('#sec-due');
    assert(payable, 'আজ আদায়যোগ্য টেবিল নেই');
    assert(promise.compareDocumentPosition(payable) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'প্রতিশ্রুতির নিচে নয়');
    assert(payable.compareDocumentPosition(due) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'বাকী কিস্তির উপরে নয়');
  });

  check('৮ পেজের three-line menu bottom-right fixed ও accessible', () => {
    const nav = $('.app-menu-shell'), button = $('#btn-app-menu'), panel = $('#app-menu-panel');
    assert(nav && button && panel, 'three-line navigation নেই');
    const items = [...nav.querySelectorAll('[data-menu-page]')];
    assert.strictEqual(items.length, 8);
    assert.deepStrictEqual(items.map((item) => item.dataset.menuPage), ['today', 'today-promise', 'payable', 'due', 'paid', 'partial', 'balance-directory', 'paid-archive']);
    assert(items.some((item) => item.textContent.includes('অন্যান্য সদস্য তালিকা')));
    assert.strictEqual(button.querySelectorAll('.app-menu-line').length, 3);
    assert.strictEqual(button.getAttribute('aria-controls'), 'app-menu-panel');
    assert(!w.document.querySelector('main').contains(nav));
    const css = fs.readFileSync('styles.css', 'utf8');
    const block = css.slice(css.indexOf('.app-menu-shell'));
    assert(/position:\s*fixed/.test(block));
    assert(/right:\s*16px/.test(block));
    assert(/bottom:\s*16px/.test(block));
    button.click();
    assert(!panel.classList.contains('hidden'));
    assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
    button.click();
    assert(panel.classList.contains('hidden'));
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
  });

  check('আজ প্রতিশ্রুতি সেকশন বাকী কিস্তির উপরে আছে', () => {
    const promise = $('#sec-today-promise'), due = $('#sec-due');
    assert(promise.compareDocumentPosition(due) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'আজ প্রতিশ্রুতি উপরে নেই');
  });

  check('মেম্বার ডিরেক্টরি টেবিলে কোড শেষের ৪/৩ সংখ্যা + A→Z', () => {
    const memberDB = [
      ['0000123', 'Zara Member', '101', '01711000000'],
      ['0000456', 'Alpha Member', '102', '01722000000'],
    ];
    const wstate = w.__state;
    wstate.memberDB = memberDB;
    wstate.memberDBHeaders = ['Member Code', 'Member Name', 'Center Code', 'Mobile'];
    w.__renderMemberDatabaseTable();
    const codes = $$('#member-db-list tr').map((tr) => tr.querySelector('td').textContent.trim());
    assert.deepStrictEqual(codes, ['0123', '0456'], codes.join(','));
    const centers = $$('#member-db-list tr').map((tr) => tr.querySelectorAll('td')[1].textContent.trim());
    assert.deepStrictEqual(centers, ['101', '102'], centers.join(','));
  });

  console.log(results.join('\n'));
  w.close();
}, 300);
