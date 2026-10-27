/* যাচাই: Today All Collection-এর স্থিতি কার্ড — ২ লাইনে
   ১ম লাইন পূর্বের স্থিতি, ২য় লাইন এন্ট্রি পরে স্থিতি (টাইপ করা অঙ্গসহ লাইভ, সেভ ছাড়াই)। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const memberDBHeaders = ['Member No', 'Center Code & Name', 'Member Name', 'Contact Number', 'Father / Husband / Care Of'];
const memberDB = [['001401418', '0006, GOBRA BAZ', 'Test Member A', '01711000001', 'Test Guardian A']];

const balanceHeaders = ['Member ID', 'Name of Member', 'Loan Outstanding', 'Savings Outstanding'];
const balanceRows = [['001401418', 'Test Member A', '5000', '1200', '0006']];

const cloud = {
  headers: ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'],
  rows: [['001401418', 'Test Member A', '0006', '1200', '0']],
  collections: [], followups: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders, balanceRows, todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__renderTodayBalanceCard = renderTodayBalanceCard;
`);

const $ = (sel) => w.document.querySelector(sel);

setTimeout(() => {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };
  const lines = () => [...$('#today-balance-summary').querySelectorAll('.balance-line')];
  const chipsOf = (line) => [...line.querySelectorAll('.balance-chip')].map((el) => el.textContent.trim());
  const tagOf = (line) => line.querySelector('.balance-tag').textContent.trim();
  const valueOf = (line, kind) => {
    const chip = [...line.querySelectorAll(`.balance-chip.${kind}`)][0];
    return chip ? chip.querySelector('b').textContent.trim() : null;
  };

  const typeCode = () => {
    ['#today-loan', '#today-savings', '#today-dps'].forEach((sel) => {
      const el = $(sel);
      el.value = '';
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    });
    const input = $('#today-member-code');
    input.value = '1418';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  };

  check('কার্ডে ২ লাইন আছে — পূর্বের স্থিতি ও এন্ট্রি পরে স্থিতি', () => {
    typeCode();
    const rows = lines();
    assert.strictEqual(rows.length, 2, `লাইন ${rows.length}টি`);
    assert.strictEqual(tagOf(rows[0]), 'পূর্বের স্থিতি', `1st line label wrong → ${tagOf(rows[0])}`);
    assert.strictEqual(tagOf(rows[1]), 'এন্ট্রি পরে স্থিতি', `2nd line label wrong → ${tagOf(rows[1])}`);
  });

  check('১ম লাইন: পূর্বের লোন/সঞ্চয় + কিস্তির তারিখ ও কিস্তির অঙ্ক', () => {
    typeCode();
    const row = lines()[0];
    assert.strictEqual(valueOf(row, 'loan'), '৳ 5,000', `loan → ${valueOf(row, 'loan')}`);
    assert.strictEqual(valueOf(row, 'savings'), '৳ 1,200', `savings → ${valueOf(row, 'savings')}`);
    const inst = [...row.querySelectorAll('.balance-chip.installment')];
    assert(inst.length >= 2, 'কিস্তির চিপ নেই');
    assert(/📅/.test(inst[0].textContent), `তারিখ চিপ → ${inst[0].textContent}`);
    const amount = inst.find((el) => el.querySelector('b'));
    assert(amount, 'কিস্তির অঙ্ক নেই');
    assert(/কিস্তি/.test(amount.textContent), `কিস্তি লেখা নেই → ${amount.textContent}`);
    assert.strictEqual(amount.querySelector('b').textContent.trim(), '৳ 1,200', `কিস্তি → ${amount.textContent}`);
    assert(!/বাকী|Due/i.test(row.textContent), `লাইনে এখনো বাকী/Due লেখা আছে → ${row.textContent}`);
  });

  check('লোন টাইপ করলে ২য় লাইন লাইভ বদলায় (সেভ ছাড়াই)', () => {
    typeCode();
    const before = w.__state.todayRows.length;
    const loan = $('#today-loan');
    loan.value = '500';
    loan.dispatchEvent(new w.Event('input', { bubbles: true }));
    const row = lines()[1];
    assert.strictEqual(valueOf(row, 'loan'), '৳ 4,500', `লোন → ${valueOf(row, 'loan')}`);
    assert.strictEqual(w.__state.todayRows.length, before, 'টাইপ করেই এন্ট্রি সেভ হয়ে গেছে!');
  });

  check('সঞ্চয় টাইপ করলে ২য় লাইনের সঞ্চয় বাড়ে', () => {
    typeCode();
    const savings = $('#today-savings');
    savings.value = '300';
    savings.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(valueOf(lines()[1], 'savings'), '৳ 1,500', `সঞ্চয় → ${valueOf(lines()[1], 'savings')}`);
  });

  check('DPS টাইপ করলে ২য় লাইনের DPS বাড়ে', () => {
    typeCode();
    const dps = $('#today-dps');
    dps.value = '50';
    dps.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(valueOf(lines()[1], 'dps'), '৳ 50', `DPS → ${valueOf(lines()[1], 'dps')}`);
  });

  check('টাইপ করা অঙ্গের মোট "নতুন এন্ট্রি" হিসেবে দেখায়', () => {
    typeCode();
    const loan = $('#today-loan');
    loan.value = '500';
    loan.dispatchEvent(new w.Event('input', { bubbles: true }));
    const pending = [...lines()[1].querySelectorAll('.balance-chip.pending')][0];
    assert(pending, 'নতুন এন্ট্রি চিপ নেই');
    assert(pending.textContent.includes('500'), `wrong value → ${pending.textContent}`);
  });

  check('এন্ট্রি ফাঁকা করলে ২য় লাইন আবার পূর্বের স্থিতির সমান হয়', () => {
    typeCode();
    const loan = $('#today-loan');
    loan.value = '500';
    loan.dispatchEvent(new w.Event('input', { bubbles: true }));
    loan.value = '';
    loan.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(valueOf(lines()[1], 'loan'), '৳ 5,000', `লোন → ${valueOf(lines()[1], 'loan')}`);
  });

  check('কোড না থাকলে কার্ডে helper message থাকে', () => {
    const input = $('#today-member-code');
    input.value = '';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const card = $('#today-balance-summary .balance-card');
    assert(card, 'কার্ড নেই');
    assert(/মেম্বার কোড/.test(card.textContent), `wrong message → ${card.textContent}`);
  });

  check('স্থিতি CSV-তে না থাকলে কার্ডে "—" দেখায়', () => {
    const input = $('#today-member-code');
    input.value = '9999';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    w.__state.memberDB = [['001999999', '0009, X', 'Test Member', '01711000009', 'Someone']];
    w.__state.memberDBHeaders = memberDBHeaders;
    input.value = '9999';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const row = lines()[0];
    assert.strictEqual(valueOf(row, 'loan'), '—', `লোন → ${valueOf(row, 'loan')}`);
    assert(/পাওয়া যায়নি/.test(row.textContent), 'note missing');
  });

  console.log(results.join('\n'));
  w.close();
}, 400);
