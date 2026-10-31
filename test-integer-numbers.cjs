/* সব প্রদর্শিত হিসাবের সংখ্যা পূর্ণসংখ্যা; মূল তিন-ঘরের auto-calculation অপরিবর্তিত। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'];
const rows = [['0000123', 'Decimal Member', '101', '1000.99', '20.49']];
const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code'];
const memberDB = [['0000123', 'Decimal Member', '101']];
const todayRows = [{
  id: 'decimal-1', memberCode: '0000123', centerCode: '101', memberName: 'Decimal Member',
  loan: 12.49, savings: 20.49, dps: 10.49, total: 43.47,
  installmentKey: '', createdAt: '2026-10-31T01:00:00Z', date: '2026-10-31',
}];
const cloud = {
  headers, rows, collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://integer.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.confirm = () => true;
w.fetch = async (url, options) => ({
  ok: true, status: 200,
  json: async () => options?.method === 'POST' || options?.method === 'PUT'
    ? { ok: true, updated_at: new Date().toISOString() } : cloud,
});
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__integerTest = {
  state, fmt, fmtMoney, num, roundMoney, wholeNumber, clearTodayForm,
  autoCalculateTodayAmounts, restoreTodayDraft, startEditToday,
  formatMemberDetails, renderTables, renderToday, DRAFT_KEY,
};`);

const $ = (selector) => w.document.querySelector(selector);
const $$ = (selector) => [...w.document.querySelectorAll(selector)];
const setVal = (key, value) => {
  const input = $('#today-' + key);
  input.value = String(value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const noDecimal = (value) => !/[0-9০-৯]\.[0-9০-৯]/.test(String(value));

setTimeout(async () => {
  const t = w.__integerTest;
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`✅ ${name}`); }
    catch (error) { results.push(`❌ ${name} → ${error.message}`); process.exitCode = 1; }
  };

  await check('12.49 → 12; 12.99 ও 12.50 → 13', () => {
    assert.strictEqual(t.fmtMoney(12.49), '12');
    assert.strictEqual(t.fmtMoney(12.99), '13');
    assert.strictEqual(t.fmtMoney(12.50), '13');
    assert.strictEqual(t.fmtMoney('1234.50'), '1,235');
    [12.49, 12.99, 12.50].forEach((value) => assert(noDecimal(t.fmtMoney(value))));
  });

  await check('বাংলা count formatter-ও integer; মূল num/roundMoney অপরিবর্তিত', () => {
    assert(noDecimal(t.fmt(12.49)));
    assert(noDecimal(t.fmt(12.99)));
    assert.strictEqual(t.num('12.49'), 12.49);
    assert.strictEqual(t.roundMoney(12.345), 12.35);
  });

  await check('সব amount ও refresh input integer-only', () => {
    ['loan', 'savings', 'dps', 'total'].forEach((key) => {
      const input = $('#today-' + key);
      assert.strictEqual(input.getAttribute('step'), '1');
      assert.strictEqual(input.getAttribute('inputmode'), 'numeric');
      assert.strictEqual(input.getAttribute('pattern'), '[0-9]*');
    });
    assert.strictEqual($('#set-refresh').getAttribute('step'), '1');
    assert.strictEqual($('#set-refresh').getAttribute('inputmode'), 'numeric');
  });

  await check('হাতে decimal point চাপা আটকে যায়', () => {
    const input = $('#today-loan');
    const event = new w.InputEvent('beforeinput', {
      data: '.', inputType: 'insertText', bubbles: true, cancelable: true,
    });
    input.dispatchEvent(event);
    assert.strictEqual(event.defaultPrevented, true);
  });

  await check('পুরোনো/paste decimal input integer হয়; auto মোট সঠিক', () => {
    t.clearTodayForm();
    setVal('loan', 12.49);
    setVal('savings', 20.99);
    setVal('dps', 10.50);
    assert.strictEqual($('#today-loan').value, '12');
    assert.strictEqual($('#today-savings').value, '21');
    assert.strictEqual($('#today-dps').value, '11');
    assert.strictEqual($('#today-total').value, '44');
    ['loan', 'savings', 'dps', 'total'].forEach((key) => assert(noDecimal($('#today-' + key).value)));
  });

  await check('পুরোনো decimal draft ফেরালেও ঘরে দশমিক থাকে না', () => {
    w.localStorage.setItem(t.DRAFT_KEY, JSON.stringify({
      memberCode: '0123', centerCode: '101', memberName: 'Decimal Member',
      loan: '12.49', savings: '20.99', dps: '10.50', total: '43.98',
      autoField: 'total', savedAt: Date.now(),
    }));
    assert.strictEqual(t.restoreTodayDraft(), true);
    assert.strictEqual($('#today-loan').value, '12');
    assert.strictEqual($('#today-savings').value, '21');
    assert.strictEqual($('#today-dps').value, '11');
    assert.strictEqual($('#today-total').value, '44');
  });

  await check('পুরোনো entry edit-এ integer; মোট আবার তিন অংকের যোগফল', () => {
    t.startEditToday(0);
    assert.strictEqual($('#today-loan').value, '12');
    assert.strictEqual($('#today-savings').value, '20');
    assert.strictEqual($('#today-dps').value, '10');
    assert.strictEqual($('#today-total').value, '43');
    t.autoCalculateTodayAmounts();
    assert.strictEqual($('#today-total').value, '42');
  });

  await check('Details-এ amount integer; code/account/date অপরিবর্তিত', () => {
    const list = t.formatMemberDetails([
      { label: 'Installment Amount', value: '12.99' },
      { label: 'Loan Account No', value: '123.456' },
      { label: 'Paid Date', value: '31.10.2026' },
      { label: 'Member Code', value: '0000123' },
    ], 3);
    assert.strictEqual(list[0].value, '13');
    assert.strictEqual(list[1].value, '123.456');
    assert.strictEqual(list[2].value, '31.10.2026');
    assert.strictEqual(list[3].value, '0123');
  });

  await check('দশমিকযুক্ত stored rows render করলেও amount cell-এ দশমিক নেই', () => {
    t.renderTables(); t.renderToday();
    const amounts = $$('.amt').map((el) => el.textContent).filter((text) => text.trim());
    assert(amounts.length > 0);
    amounts.forEach((text) => assert(noDecimal(text), text));
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 450);
