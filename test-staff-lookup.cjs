/* Cached staff lookup must preserve the original first-row/unique-center semantics. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const emptyDocument = {
  headers: [], rows: [], collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [], staffDirectory: [] },
};
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.fetch = async () => ({ ok: true, status: 200, json: async () => emptyDocument });
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__current = currentStaffForMember;
window.__center = staffForCenter;
window.__directoryStaff = directoryStaff;
`);

setTimeout(() => {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push('✅ ' + name); }
    catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
  };
  const state = w.__state;
  state.isOnline = false;
  state.headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name'];
  state.rows = [
    ['0001', 'First', '001', 'Alice'],
    ['0001', 'Duplicate', '001', 'Bob'],
    ['0002', 'Blank first', '002', ''],
    ['0002', 'Later staff', '002', 'Charlie'],
    ['0003', 'Center unique', '003', 'Alice'],
  ];
  state.staffDirectory = [
    { name: 'Dave', members: ['0002'], centers: [] },
    { name: 'Eve', members: ['0009'], centers: ['009'] },
  ];
  state.paidArchive = [{ memberCode: '0005', centerCode: '003', staffName: 'Alice' }];
  state.detect = { memberCode: 0, memberName: 1, centerCode: 2, staffName: 3, staff: -1 };

  check('Current report-এর প্রথম matching member row-ই staff নির্ধারণ করে', () => {
    assert.strictEqual(w.__current('0001'), 'Alice');
    assert.strictEqual(w.__current('01'), 'Alice');
  });

  check('প্রথম row-র staff খালি হলে পরের row/directory থেকে ভিন্ন staff নেয় না', () => {
    assert.strictEqual(w.__current('0002'), '');
  });

  check('Report-এ না থাকলে একমাত্র directory staff পাওয়া যায়', () => {
    assert.strictEqual(w.__current('0009'), 'Eve');
    assert.strictEqual(w.__center('009'), 'Eve');
  });

  check('Center-এ একাধিক staff থাকলে অনুমান করে কাউকে বেছে নেয় না', () => {
    assert.strictEqual(w.__center('001'), '');
    assert.strictEqual(w.__center('003'), 'Alice');
  });

  check('Rows/archive reference বদলালে cache নিজে থেকে refresh হয়', () => {
    assert.strictEqual(w.__current('0001'), 'Alice');
    const replacement = state.rows.map((row) => [...row]);
    replacement[0][3] = 'Changed';
    state.rows = replacement;
    assert.strictEqual(w.__current('0001'), 'Changed');
    state.paidArchive = [{ memberCode: '0005', centerCode: '003', staffName: 'Bob' }];
    assert.strictEqual(w.__center('003'), '');
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 500);
