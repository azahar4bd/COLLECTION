/* Member code টাইপ করার সময় partial suffix match যেন input বদলে না দেয়। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code', 'Mobile'];
const memberDB = [
  ['001405254', 'Josna Adhikari', '012', '01711000000'],
  ['0000123', 'Zara Member', '101', '01722000000'],
];
const cloud = {
  headers: ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'],
  rows: [], collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + '\n;window.__state = state; window.__clear = clearTodayForm;');

const $ = selector => w.document.querySelector(selector);
const input = () => $('#today-member-code');
const type = text => {
  for (const character of text) {
    input().value += character;
    input().dispatchEvent(new w.Event('input', { bubbles: true }));
  }
};

setTimeout(() => {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (error) { results.push(`❌ ${name} → ${error.message}`); process.exitCode = 1; }
  };

  check('আংশিক 254 মিলে গেলেও 2547 টাইপ করলে 52547 হয় না', () => {
    w.__clear();
    let expected = '';
    for (const character of '2547') {
      expected += character;
      input().value += character;
      input().dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.strictEqual(input().value, expected, `টাইপ বদলে গেছে: ${input().value}`);
    }
    assert.strictEqual(w.__state.todayRawMember, '');
    assert.strictEqual($('#today-member-name').value, '');
  });

  check('সঠিক ৪-সংখ্যার code শেষ হলে নাম/সেন্টার আসে, code অপরিবর্তিত থাকে', () => {
    w.__clear();
    type('5254');
    assert.strictEqual(input().value, '5254');
    assert.strictEqual(w.__state.todayRawMember, '001405254');
    assert.strictEqual($('#today-member-name').value, 'Josna Adhikari');
    assert.strictEqual($('#today-center-code').value, '012');
  });

  check('মিলে যাওয়া code-এর পরে আরও লিখলে পুরোনো সদস্যের নাম লেগে থাকে না', () => {
    type('7');
    assert.strictEqual(input().value, '52547');
    assert.strictEqual(w.__state.todayRawMember, '');
    assert.strictEqual($('#today-member-name').value, '');
    assert.strictEqual($('#today-center-code').value, '');
  });

  check('পুরো মূল code টাইপ নিরাপদ; change-এ সংক্ষিপ্ত code ও সঠিক সদস্য থাকে', () => {
    w.__clear();
    type('001405254');
    assert.strictEqual(input().value, '001405254');
    assert.strictEqual($('#today-member-name').value, 'Josna Adhikari');
    input().dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(input().value, '5254');
    assert.strictEqual(w.__state.todayRawMember, '001405254');
    assert.strictEqual($('#today-member-name').value, 'Josna Adhikari');
  });

  console.log(results.join('\n'));
  console.log(`✅ পাস: ${results.filter(x => x.startsWith('✅')).length}   ❌ ফেল: ${results.filter(x => x.startsWith('❌')).length}`);
  w.close();
}, 350);
