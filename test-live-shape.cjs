/* যাচাই: লাইভ MIS CSV-এর আকৃতিতে (EmpName, CenterCode, MemberCode, InstallmentStartDate…) —
   তারিখ কলাম সঠিকভাবে শনাক্ত হয়, কোড না মিললে নামে মিলে ডাটাবেজের তথ্য আসে,
   আর না মিললে স্পষ্ট ইঙ্গিত দেখায়। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['SLNo', 'OfficeID', 'OfficeCode', 'OfficeName', 'EmpName', 'CenterCode', 'CenterName',
  'MemberCode', 'MemberName', 'ProductCode', 'ProductName', 'MainProductCode', 'MainItemName',
  'EmployeeCode', 'PhoneNo', 'DisburseDate', 'PrincipalLoan', 'Duration', 'MonthPassed', 'LBalance',
  'SCBalance', 'InstallmentStartDate', 'InstallmentAmount', 'InstallmentDateActual', 'InstallmentActual',
  'Remarks', 'LoanSummaryID', 'IntCharge', 'NoOfFullPayement', 'NoOfPartialPayement', 'NoOfNotPayement'];

const rows = [
  ['1', '35', '14', 'GOBRA BRANCH', 'MD. MONIRUL ISLAM', '001', '0001, GOBRA BAZAR', '1405808', 'Test Member D',
    '30.03', '30.03, Agrasor-MFCE-1.5Yrs/M', '1086', 'Agrasor-MFCE Loan', '1994', '01711000001',
    '4/5/2026', '350000', '18', '4', '272232', '39478', '4/10/2026', '22260', '', '0', '', '552038', '3368.87', '0', '0', '1'],
  ['2', '35', '14', 'GOBRA BRANCH', 'AZAZ SAKIB', '156', '0156, AGDIA', '1405795', 'Test Member C',
    '30.03', '30.03, Agrasor-MFCE-1.5Yrs/M', '1086', 'Agrasor-MFCE Loan', '1994', '01711000002',
    '4/5/2026', '350000', '18', '4', '272232', '39478', '4/10/2026', '22260', '', '500', '', '552038', '3368.87', '0', '1', '1'],
];

const memberDBHeaders = ['Sl. No.', '', 'Center Code & Name', 'Member No', '', 'Member Name', '', 'Contact Number',
  'Father / Husband / Care Of', 'Age', 'Joining Date', '', 'Pre Member Code', '', '', 'Drop Out Date', 'Status', 'Member Type', '', ''];
const memberDB = [
  ['1', '', '0156, AGDIA', '001405795', '', 'Test Member C', '', '01711000002', 'Test Guardian C', '45', '12-Jan-2018', '', '', '', '', 'Active', 'Member', '', ''],
  ['2', '', '0001, GOBRA BAZAR', '001401418', '', 'Test Member D', '', '01711000001', 'Test Guardian D', '38', '05-Feb-2015', '', '', '', '', 'Active', 'Member', '', ''],
];

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
window.__detect = detectColumns;
window.__merge = mergeDirectoryDetails;
window.__open = openMemberDetailsFromRow;
`);

const $ = (sel) => w.document.querySelector(sel);

setTimeout(() => {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };
  const items = () => [...$('#member-detail-grid').querySelectorAll('.detail-item')]
    .map((el) => [el.querySelector('span').textContent.trim(), el.querySelector('strong').textContent.trim()]);

  check('তারিখ কলাম = InstallmentStartDate (InstallmentDateActual নয়)', () => {
    const d = w.__detect(headers);
    assert.strictEqual(headers[d.date], 'InstallmentStartDate', `তারিখ = ${headers[d.date]}`);
  });

  check('ষ্টাফ নাম EmpName থেকে, সেন্টার ও মেম্বার কোড সঠিক', () => {
    const d = w.__detect(headers);
    assert.strictEqual(headers[d.staffName], 'EmpName', `ষ্টাফ = ${headers[d.staffName]}`);
    assert.strictEqual(headers[d.centerCode], 'CenterCode', `সেন্টার = ${headers[d.centerCode]}`);
    assert.strictEqual(headers[d.memberCode], 'MemberCode', `মেম্বার কোড = ${headers[d.memberCode]}`);
    assert.strictEqual(headers[d.amount], 'InstallmentAmount', `কিস্তি = ${headers[d.amount]}`);
    assert.strictEqual(headers[d.actual], 'InstallmentActual', `আদায় = ${headers[d.actual]}`);
  });

  check('কোডে মিললে ডাটাবেজের পিতার নাম আসে', () => {
    w.__open(1);
    const guardian = items().find(([label]) => /Father/i.test(label));
    assert(guardian, 'পিতার নাম নেই');
    assert.strictEqual(guardian[1], 'Test Guardian C', `ভুল → ${guardian[1]}`);
  });

  check('কোড না মিললে নাম দিয়ে মিলে পিতার নাম আসে', () => {
    // ১ম সারির কোড 1405808 ডাটাবেজে নেই, কিন্তু নাম "Test Member D" আছে
    w.__open(0);
    const guardian = items().find(([label]) => /Father/i.test(label));
    assert(guardian, 'নামে মিলিয়ে পিতার নাম আসেনি');
    assert.strictEqual(guardian[1], 'Test Guardian D', `ভুল → ${guardian[1]}`);
  });

  check('কোনোভাবেই না মিললে স্পষ্ট ইঙ্গিত দেখায়', () => {
    const merged = w.__merge([{ label: 'MemberCode', value: '9999999' }], '9999999', '001', 'কেউ নেই এমন নাম');
    assert.strictEqual(merged.matched, false, 'ভুল করে মিলেছে');
    const hint = merged.entries.find((e) => e.hint);
    assert(hint, 'ইঙ্গিত নেই');
    assert(/active contact list/.test(hint.label), 'hint text wrong');
  });

  check('সেন্টার "0001, GOBRA BAZAR" থেকে কোড ও নাম আলাদা', () => {
    w.__open(0);
    const center = items().find(([label]) => label === 'CenterCode');
    assert(center, 'সেন্টার কোড নেই');
    assert.strictEqual(center[1], '001', `সেন্টার কোড ভুল → ${center[1]}`);
    const name = items().find(([label]) => label === 'CenterName');
    assert(name, 'সেন্টারের নাম নেই');
    assert.strictEqual(name[1], 'GOBRA BAZAR', `সেন্টারের নাম ভুল → ${name[1]}`);
  });

  console.log(results.join('\n'));
  w.close();
}, 300);
