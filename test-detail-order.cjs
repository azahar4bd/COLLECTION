/* যাচাই: MIS লোন CSV-তে পিতা/স্বামী/অভিভাবকের তথ্য উপরে থাকে —
   ডিটেইলসে গুরুত্বপূর্ণ তথ্য আগে, MIS-টেকনিক্যাল তথ্য পরে আলাদা হেডিংয়ে দেখায়। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

// বাস্তব MIS CSV-এর মতো কলাম ক্রম
const headers = ['LoanSummaryID', 'Father / Husband / Care Of', 'SLNo', 'Center Code & Name', 'MEMBERCODE',
  'MEMBERNAME', 'PHONENO', 'DISBURSE DATE', 'PRINCIPALLOAN', 'DURATION', 'MONTHPASSED', 'LBALANCE',
  'INSTALLMENTSTARTDATE', 'INSTALLMENTAMOUNT', 'INSTALLMENTDATEACTUAL', 'INSTALLMENTACTUAL',
  'INTCHARGE', 'NOOFFULLPAYMENT', 'NOOFPARTIALPAYMENT', 'NOOFINSTALMENTPAID'];
const rows = [
  ['LS-1081', 'MD. MONIRUL ISLAM', '1', '0001, GOBRA BAZAR', '1081', 'Nasir Molla', '1724597985',
    '23-06-2025', '350000', '18', '15', '58309', '26-10-2026', '23334', '', '0', '971.82', '0', '0', '3'],
];

// সদস্য ডাটাবেজে Status ও Member Type থাকলেও সেগুলো বিস্তারিত কার্ডে দেখাবে না (v9.9)
const memberDBHeaders = ['Member No', 'Member Name', 'Contact Number', 'Father / Husband / Care Of',
  'Age', 'Joining Date', 'Status', 'Member Type'];
const memberDB = [['1081', 'Nasir Molla', '1724597985', 'Test Guardian D', '42', '13-Aug-2025', 'Active', 'Member']];

const cloud = {
  headers, rows, collections: [], followups: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__openMemberDetailsFromRow = openMemberDetailsFromRow;
window.__detailPriority = detailPriority;
`);

const $ = (sel) => w.document.querySelector(sel);

setTimeout(() => {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };
  const kids = () => [...$('#member-detail-grid').children];
  const items = () => kids().filter((el) => !el.classList.contains('detail-divider') && !el.classList.contains('detail-hint'))
    .map((el) => [el.querySelector('span').textContent.trim(), el.querySelector('strong').textContent.trim()]);
  const labels = () => items().map(([label]) => label);

  check('পিতা/স্বামী/অভিভাবকের মান মোডালে দেখা যাচ্ছে', () => {
    w.__openMemberDetailsFromRow(0);
    const guardian = items().find(([label]) => /Father/i.test(label));
    assert(guardian, 'Father / Husband / Care Of নেই');
    assert.strictEqual(guardian[1], 'MD. MONIRUL ISLAM', `ভুল মান → ${guardian[1]}`);
  });

  check('পিতা/স্বামী/অভিভাবক উপরে দেখা যায় (লেবেল সহ, স্ক্রল লাগে না)', () => {
    const order = labels();
    const guardianAt = order.findIndex((l) => /Father/i.test(l));
    assert(guardianAt >= 0, 'পাওয়া যায়নি');
    assert(guardianAt <= 4, `পিতার তথ্য ${guardianAt + 1}-তম অবস্থানে — উপরে উচিত`);
  });

  check('মেম্বার কোড, নাম, সেন্টার, পিতার নাম, মোবাইল আগে আসে', () => {
    const order = labels();
    assert.deepStrictEqual(order.slice(0, 6).map((l) => l.toLowerCase()),
      ['membercode', 'membername', 'center code & name', 'father / husband / care of', 'সেন্টারের নাম', 'phoneno'],
      order.slice(0, 6).join(' | '));
  });

  check('"Center Code & Name" থেকে কোড ও নাম আলাদা হয়', () => {
    const center = items().find(([label]) => /center code & name/i.test(label));
    assert(center, 'সেন্টার কোড নেই');
    assert.strictEqual(center[1], '001', `সেন্টার কোড শেষ ৩ সংখ্যা নয় → ${center[1]}`);
    const name = items().find(([label]) => /^সেন্টারের নাম$/.test(label));
    assert(name, 'Center name missing');
    assert.strictEqual(name[1], 'GOBRA BAZAR', `সেন্টারের নাম ভুল → ${name[1]}`);
  });

  check('মেম্বার কোড শেষ ৪ সংখ্যায় দেখায়', () => {
    const code = items().find(([label]) => label === 'MEMBERCODE');
    assert.strictEqual(code[1], '1081', `ভুল → ${code[1]}`);
  });

  check('SLNo ও LoanSummaryID দেখানো হয় না', () => {
    const order = labels();
    assert(!order.includes('SLNo'), 'SLNo দেখা যাচ্ছে');
    assert(!order.includes('LoanSummaryID'), 'LoanSummaryID দেখা যাচ্ছে');
  });

  check('MIS-টেকনিক্যাল তথ্য আলাদা হেডিংয়ের নিচে', () => {
    const divider = kids().find((el) => el.classList.contains('detail-divider') && /loan|mis/i.test(el.textContent));
    assert(divider, 'হেডিং নেই');
    assert(/loan|mis/i.test(divider.textContent), `heading label wrong → ${divider.textContent}`);
    const after = kids().slice(kids().indexOf(divider) + 1)
      .filter((el) => el.classList.contains('detail-item'))
      .map((el) => el.querySelector('span').textContent.trim());
    ['PRINCIPALLOAN', 'DURATION', 'MONTHPASSED', 'LBALANCE']
      .forEach((name) => assert(after.includes(name), `${name} হেডিংয়ের পরে নেই`));
  });

  check('গুরুত্বপূর্ণ তথ্য হেডিংয়ের আগে আছে', () => {
    const dividerAt = kids().findIndex((el) => el.classList.contains('detail-divider') && /loan|mis/i.test(el.textContent));
    const before = kids().slice(0, dividerAt)
      .filter((el) => el.classList.contains('detail-item'))
      .map((el) => el.querySelector('span').textContent.trim());
    assert(before.includes('Father / Husband / Care Of'), 'পিতার তথ্য হেডিংয়ের আগে নেই');
    assert(before.includes('MEMBERCODE'), 'মেম্বার কোড হেডিংয়ের আগে নেই');
  });

  check('INTCHARGE / NOOF* পেমেন্ট কার্ড বাদ (v9.9)', () => {
    const labels = kids().map((el) => (el.querySelector('span') || {}).textContent || '')
      .map((t) => t.trim());
    ['INTCHARGE', 'NOOFFULLPAYMENT', 'NOOFPARTIALPAYMENT', 'NOOFNOTPAYMENT']
      .forEach((name) => assert(!labels.includes(name), `${name} এখনো দেখাচ্ছে`));
  });

  check('STATUS ও MEMBER TYPE কার্ড বাদ (v9.9)', () => {
    const labels = kids().map((el) => (el.querySelector('span') || {}).textContent || '')
      .map((t) => t.trim());
    assert(!labels.some((t) => /^status$/i.test(t)), 'Status এখনো দেখাচ্ছে');
    assert(!labels.some((t) => /^member\s*type$/i.test(t)), 'Member Type এখনো দেখাচ্ছে');
  });

  console.log(results.join('\n'));
  w.close();
}, 300);
