/* Today: সেন্টারভিত্তিক subtotal/সর্বমোট + চার ঘরের যেকোনো তিনটি থেকে অটো-হিসাব। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['0000123', 'Zara Member', '101', '1000', '0'],
  ['0000456', 'Alpha Member', '102', '1000', '0'],
];
const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code'];
const memberDB = [
  ['0000123', 'Zara Member', '101'],
  ['0000456', 'Alpha Member', '102'],
  ['0000789', 'Beta Member', '103'],
];
const todayRows = [
  { memberCode: '0000123', centerCode: '101', memberName: 'Zara A', loan: 100, savings: 20, dps: 10, total: 130, installmentKey: 'a', createdAt: '2026-10-22T01:00:00Z', date: '2026-10-22' },
  { memberCode: '0000123', centerCode: '101', memberName: 'Zara B', loan: 25, savings: 5, dps: 5, total: 35, installmentKey: 'b', createdAt: '2026-10-22T02:00:00Z', date: '2026-10-22' },
  { memberCode: '0000456', centerCode: '102', memberName: 'Alpha', loan: 50, savings: 5, dps: 5, total: 60, installmentKey: 'c', createdAt: '2026-10-22T03:00:00Z', date: '2026-10-22' },
  { memberCode: '0000999', centerCode: '104', memberName: 'Other A', loan: 0, savings: 40, dps: 30, total: 70, installmentKey: '', createdAt: '2026-10-22T04:00:00Z', date: '2026-10-22' },
  { memberCode: '0000888', centerCode: '103', memberName: 'Other B', loan: 0, savings: 10, dps: 10, total: 20, installmentKey: '', createdAt: '2026-10-22T05:00:00Z', date: '2026-10-22' },
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
w.fetch = async (url, options) => ({
  ok: true, status: 200,
  json: async () => options?.method === 'POST' || options?.method === 'PUT'
    ? { ok: true, updated_at: new Date().toISOString() }
    : cloud,
});
w.eval(fs.readFileSync('app.js', 'utf8') + `\n;window.__state = state; window.__clearForm = clearTodayForm; window.__add = addTodayRow; window.__saveDraft = saveTodayDraft; window.__restoreDraft = restoreTodayDraft;`);

const $ = (sel) => w.document.querySelector(sel);
const $$ = (sel) => [...w.document.querySelectorAll(sel)];
const bn2en = (value) => String(value).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const number = (value) => Number(bn2en(value).replace(/[^0-9.]/g, ''));
const setVal = (key, value) => {
  const input = $('#today-' + key);
  input.value = String(value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const fillAmounts = (values) => {
  w.__clearForm();
  Object.entries(values).forEach(([key, value]) => setVal(key, value));
};
const subtotalValues = (prefix, center) => {
  const cells = $$(`#today-${prefix}-list tr.today-center-total[data-center-total="${center}"] td`);
  assert(cells.length === 6, `${prefix}/${center}: subtotal cells ${cells.length}`);
  return [1, 2, 3, 4].map((index) => number(cells[index].textContent));
};

setTimeout(async () => {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };

  await check('মাসিক তালিকা সেন্টার অনুযায়ী দলবদ্ধ; প্রতি দলের পরে subtotal', () => {
    const classes = $$('#today-monthly-list tr').map((tr) => tr.className);
    assert.deepStrictEqual(classes, ['today-row', 'today-row', 'today-center-total', 'today-row', 'today-center-total'], classes.join('|'));
    assert.deepStrictEqual(subtotalValues('monthly', '101'), [125, 25, 15, 165]);
    assert.deepStrictEqual(subtotalValues('monthly', '102'), [50, 5, 5, 60]);
  });

  await check('অন্যান্য তালিকাতেও প্রতি সেন্টারের subtotal', () => {
    assert.deepStrictEqual(subtotalValues('other', '103'), [0, 10, 10, 20]);
    assert.deepStrictEqual(subtotalValues('other', '104'), [0, 40, 30, 70]);
  });

  await check('দুই তালিকার সর্বমোট সব সেন্টারের যোগফলের সমান', () => {
    ['loan', 'savings', 'dps', 'total'].forEach((key) => {
      const monthly = { loan: 175, savings: 30, dps: 20, total: 225 }[key];
      const other = { loan: 0, savings: 50, dps: 40, total: 90 }[key];
      assert.strictEqual(number($(`#today-monthly-total-${key}`).textContent), monthly, `monthly/${key}`);
      assert.strictEqual(number($(`#today-other-total-${key}`).textContent), other, `other/${key}`);
    });
  });

  await check('লোন + সঞ্চয় + DPS → মোট অটো', () => {
    fillAmounts({ loan: 100, savings: 20, dps: 10 });
    assert.strictEqual($('#today-total').value, '130');
    assert.strictEqual($('#today-total').dataset.autoCalc, '1');
  });

  await check('লোন + সঞ্চয় + মোট → DPS অটো', () => {
    fillAmounts({ loan: 100, savings: 20, total: 150 });
    assert.strictEqual($('#today-dps').value, '30');
    assert.strictEqual($('#today-dps').dataset.autoCalc, '1');
  });

  await check('লোন + DPS + মোট → সঞ্চয় অটো', () => {
    fillAmounts({ loan: 100, dps: 30, total: 180 });
    assert.strictEqual($('#today-savings').value, '50');
  });

  await check('সঞ্চয় + DPS + মোট → লোন অটো', () => {
    fillAmounts({ savings: 40, dps: 30, total: 200 });
    assert.strictEqual($('#today-loan').value, '130');
  });

  await check('উৎসের অঙ্ক বদলালে auto মোট আবার হিসাব হয়', () => {
    fillAmounts({ loan: 100, savings: 20, dps: 10 });
    setVal('loan', 120);
    assert.strictEqual($('#today-total').value, '150');
    setVal('loan', 140);
    assert.strictEqual($('#today-total').value, '170');
  });

  await check('উৎসের ঘর মুছলে পুরোনো auto মোট মুছে যায়; auto ঘর নিজে মুছলে ফাঁকা থাকে', () => {
    fillAmounts({ loan: 100, savings: 20, dps: 10 });
    setVal('dps', '');
    assert.strictEqual($('#today-total').value, '', 'স্টেল মোট রয়ে গেছে');
    fillAmounts({ loan: 100, savings: 20, dps: 10 });
    setVal('total', '');
    assert.strictEqual($('#today-total').value, '', 'auto মোট নিজে মুছলে ফিরে এসেছে');
  });

  await check('মোট ছোট হলে ঋণাত্মক অঙ্ক বসে না', () => {
    fillAmounts({ total: 100, loan: 120, savings: 10 });
    assert.strictEqual($('#today-dps').value, '');
    assert($('#today-amount-note').classList.contains('error'), 'ভুলের নোট নেই');
  });

  await check('খসড়া ফেরালে মোট ও auto-field অবস্থা ফিরে আসে', async () => {
    fillAmounts({ loan: 100, savings: 20, dps: 10 });
    w.__saveDraft();
    await new Promise((resolve) => setTimeout(resolve, 300));
    ['loan', 'savings', 'dps', 'total'].forEach((key) => { $('#today-' + key).value = ''; });
    assert.strictEqual(w.__restoreDraft(), true, 'খসড়া ফেরেনি');
    assert.strictEqual($('#today-total').value, '130');
    assert.strictEqual($('#today-total').dataset.autoCalc, '1');
  });

  await check('অটো-হিসাব করা মান দিয়ে এন্ট্রি সেভ হয়', async () => {
    w.__state.todayRows = [];
    w.__clearForm();
    setVal('member-code', '0789');
    setVal('savings', 40); setVal('dps', 30); setVal('total', 200);
    assert.strictEqual($('#today-loan').value, '130');
    await w.__add();
    assert.strictEqual(w.__state.todayRows.length, 1, 'এন্ট্রি সেভ হয়নি');
    assert.strictEqual(w.__state.todayRows[0].loan, 130);
    assert.strictEqual(w.__state.todayRows[0].total, 200);
  });

  await check('মোট ও অংকের অমিল থাকলে ভুল এন্ট্রি আটকে যায়', async () => {
    w.__state.todayRows = [];
    w.__clearForm();
    setVal('member-code', '0789');
    setVal('loan', 100); setVal('savings', 20); setVal('dps', 10);
    setVal('total', 999);
    await w.__add();
    assert.strictEqual(w.__state.todayRows.length, 0, 'অমিল থাকলেও এন্ট্রি হয়েছে');
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 400);
