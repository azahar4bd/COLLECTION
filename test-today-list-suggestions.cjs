/* Today All Collection: স্থিতি-কলাম বাদ, দুই তালিকার যোগফল, টাইপ-সাজেশন। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['0000123', 'Zara Member', '101', 'Collector A', '1000', '0'],
  ['0000456', 'Alpha Member', '102', 'Collector A', '1000', '0'],
];
const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code', 'Mobile'];
const memberDB = [
  ['0000123', 'Zara Member', '101', '01711000000'],
  ['0000456', 'Alpha Member', '102', '01722000000'],
  ['0000789', 'Beta Member', '103', '01733000000'],
];
const todayRows = [
  { memberCode: '0000123', centerCode: '101', memberName: 'Zara Member', loan: 100, savings: 20, dps: 10, total: 130, installmentKey: 'monthly-a', createdAt: '2026-10-22T01:00:00Z', date: '2026-10-22' },
  { memberCode: '0000456', centerCode: '102', memberName: 'Alpha Member', loan: 50, savings: 5, dps: 5, total: 60, installmentKey: 'monthly-b', createdAt: '2026-10-22T02:00:00Z', date: '2026-10-22' },
  { memberCode: '0000999', centerCode: '104', memberName: 'Other Member', loan: 0, savings: 40, dps: 30, total: 70, installmentKey: '', createdAt: '2026-10-22T03:00:00Z', date: '2026-10-22' },
];
const cloud = {
  headers, rows, collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + `\n;window.__state = state; window.__renderToday = renderToday;`);

const $ = (sel) => w.document.querySelector(sel);
const $$ = (sel) => [...w.document.querySelectorAll(sel)];
const bn2en = (value) => String(value).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const number = (value) => Number(bn2en(value).replace(/[^0-9.]/g, ''));

setTimeout(() => {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };

  check('মাসিক ও অন্যান্য—দুই তালিকাতেই স্থিতির ৩ কলাম বাদ, মোট পর্যন্ত ৯ কলাম', () => {
    ['#today-monthly-list', '#today-other-list'].forEach((sel) => {
      const table = $(sel).closest('table');
      const headings = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      assert.deepStrictEqual(headings, ['#', 'মেম্বার কোড', 'সেন্টার কোড', 'মেম্বার নাম', 'লোন', 'সঞ্চয়', 'DPS', 'মোট', 'কাজ'], headings.join('|'));
      assert(!/স্থিতি/.test(headings.join('|')), 'স্থিতি-কলাম এখনো আছে');
      const bodyCells = $(sel).querySelector('tr.today-row').querySelectorAll('td');
      assert.strictEqual(bodyCells.length, 9, `${sel} সারির কলাম ${bodyCells.length}`);
    });
  });

  check('মাসিক আদায়ের নিচে লোন/সঞ্চয়/DPS/মোট যোগফল', () => {
    assert.strictEqual(number($('#today-monthly-total-loan').textContent), 150);
    assert.strictEqual(number($('#today-monthly-total-savings').textContent), 25);
    assert.strictEqual(number($('#today-monthly-total-dps').textContent), 15);
    assert.strictEqual(number($('#today-monthly-total-total').textContent), 190);
  });

  check('অন্যান্য আদায়ের নিচে আলাদা যোগফল', () => {
    assert.strictEqual(number($('#today-other-total-loan').textContent), 0);
    assert.strictEqual(number($('#today-other-total-savings').textContent), 40);
    assert.strictEqual(number($('#today-other-total-dps').textContent), 30);
    assert.strictEqual(number($('#today-other-total-total').textContent), 70);
  });

  check('মেম্বার কোড লেখা শুরু করলেই নিচে দৃশ্যমান সাজেশন', () => {
    const input = $('#today-member-code');
    input.value = '012';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const panel = $('#today-code-suggestions');
    assert(!panel.classList.contains('hidden'), 'সাজেশন লুকানো');
    assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
    const options = $$('#today-code-suggestions [data-today-suggestion]');
    assert(options.length >= 1, 'কোনো সাজেশন নেই');
    assert(options[0].textContent.includes('Zara Member'), options[0].textContent);
    assert(options[0].textContent.includes('0123'), 'শেষ ৪ সংখ্যা নেই');
  });

  check('কোড সাজেশনে ট্যাপ করলে নাম/সেন্টার অটো-ফিল ও তালিকা বন্ধ', () => {
    $('#today-code-suggestions [data-today-suggestion]').click();
    assert.strictEqual($('#today-member-code').value, '0123');
    assert.strictEqual($('#today-member-name').value, 'Zara Member');
    assert.strictEqual($('#today-center-code').value, '101');
    assert($('#today-code-suggestions').classList.contains('hidden'), 'সাজেশন বন্ধ হয়নি');
  });

  check('নাম লিখলেও সাজেশন; বেছে নিলে মেম্বার কোড বসে', () => {
    const input = $('#today-member-name');
    input.value = 'Alp';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const panel = $('#today-name-suggestions');
    assert(!panel.classList.contains('hidden'), 'নামের সাজেশন লুকানো');
    const option = $('#today-name-suggestions [data-today-suggestion]');
    assert(option && option.textContent.includes('Alpha Member'), 'Alpha সাজেশন নেই');
    option.click();
    assert.strictEqual($('#today-member-code').value, '0456');
    assert.strictEqual($('#today-member-name').value, 'Alpha Member');
    assert.strictEqual($('#today-center-code').value, '102');
    assert(panel.classList.contains('hidden'), 'নামের সাজেশন বন্ধ হয়নি');
  });

  check('তালিকা খালি করলে যোগফলও শূন্য হয়', () => {
    w.__state.todayRows = [];
    w.__renderToday();
    ['monthly', 'other'].forEach((prefix) => {
      ['loan', 'savings', 'dps', 'total'].forEach((key) => {
        assert.strictEqual(number($(`#today-${prefix}-total-${key}`).textContent), 0, `${prefix}/${key}`);
      });
    });
  });

  console.log(results.join('\n'));
  console.log(`✅ পাস: ${results.filter((x) => x.startsWith('✅')).length}   ❌ ফেল: ${results.filter((x) => x.startsWith('❌')).length}`);
  w.close();
}, 350);
