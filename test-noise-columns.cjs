/* যাচাই: অপ্রয়োজনীয় MIS কলাম (SLNo, OfficeID, OfficeCode, OfficeName, ProductCode,
   ProductName, MainProductCode, MainItemName, EmployeeCode, SCBalance, Remarks,
   LoanSummaryID) ডিটেইলসে দেখানো হয় না। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = [
  'SLNo', 'OfficeID', 'OfficeCode', 'OfficeName', 'ProductCode', 'ProductName',
  'MainProductCode', 'MainItemName', 'EmployeeCode', 'SCBalance', 'Remarks', 'LoanSummaryID',
  'Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual', 'Mobile',
];
const rows = [
  ['1', 'O-9', '0006', 'GOBRA BAZ', 'P-01', 'মূলধন', 'MP-1', 'দিনের আয়', 'E-77', '1200', 'ভালো', 'LS-001',
    '001401418', 'Test Member A', '0006', '1200', '0', '01711000001'],
];

const memberDBHeaders = ['SLNo', 'OfficeID', 'OfficeCode', 'OfficeName', 'ProductCode', 'ProductName',
  'MainProductCode', 'MainItemName', 'EmployeeCode', 'SCBalance', 'Remarks', 'LoanSummaryID',
  'Member No', 'Member Name', 'Center Code & Name', 'Contact Number', 'Father / Husband / Care Of'];
const memberDB = [
  ['1', 'O-9', '0006', 'GOBRA BAZ', 'P-01', 'মূলধন', 'MP-1', 'দিনের আয়', 'E-77', '1200', 'ভালো', 'LS-001',
    '001401418', 'Test Member A', '0006, GOBRA BAZ', '01711000001', 'Test Guardian A'],
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
window.__showPage = showPage;
window.__openMemberDetailsFromRow = openMemberDetailsFromRow;
window.__openTodayDetails = openTodayDetails;
window.__isNoiseColumn = isNoiseColumn;
`);

const $ = (sel) => w.document.querySelector(sel);

setTimeout(() => {
  // New pages render lazily; this legacy multi-table suite explicitly opens the all-tables view.
  w.__showPage('installments');
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };
  const detailItems = () => [...document_detail_items()];
  function document_detail_items() {
    return [...$('#member-detail-grid').querySelectorAll('.detail-item')].map((el) => [el.querySelector('span').textContent.trim(), el.querySelector('strong').textContent.trim()]);
  }
  const labels = () => detailItems().map(([label]) => label);
  const NOISE = ['SLNo', 'OfficeID', 'OfficeCode', 'OfficeName', 'ProductCode', 'ProductName',
    'MainProductCode', 'MainItemName', 'EmployeeCode', 'SCBalance', 'Remarks', 'LoanSummaryID'];

  check('অপ্রয়োজনীয় কলাম শনাক্ত করা হয়', () => {
    NOISE.forEach((name) => assert(w.__isNoiseColumn(name), `${name} ধরা পড়েনি`));
    ['Member Code', 'Member Name', 'Center Code', 'Mobile', 'Father / Husband / Care Of', 'Age', 'Status', 'Installment Amount']
      .forEach((name) => assert(!w.__isNoiseColumn(name), `${name} ভুল করে বাদ পড়ছে`));
  });

  check('কিস্তি সারির ডিটেইলসে অপ্রয়োজনীয় কলাম নেই', () => {
    w.__openMemberDetailsFromRow(0);
    const shown = labels();
    NOISE.forEach((name) => assert(!shown.includes(name), `${name} দেখা যাচ্ছে`));
  });

  check('প্রয়োজনীয় কলাম ঠিকই দেখা যাচ্ছে', () => {
    const shown = labels();
    ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual', 'Mobile']
      .forEach((name) => assert(shown.includes(name), `${name} নেই`));
    const code = detailItems().find(([label]) => label === 'Member Code');
    assert.strictEqual(code[1], '1418', `মেম্বার কোড শেষ ৪ সংখ্যা নয় → ${code[1]}`);
    const center = detailItems().find(([label]) => label === 'Center Code');
    assert.strictEqual(center[1], '006', `সেন্টার কোড শেষ ৩ সংখ্যা নয় → ${center[1]}`);
  });

  check('ডাটাবেজ থেকে আসা তথ্যেও অপ্রয়োজনীয় কলাম নেই, পিতার নাম আছে', () => {
    w.__openMemberDetailsFromRow(0);
    const shown = labels();
    NOISE.forEach((name) => assert(!shown.includes(name), `${name} দেখা যাচ্ছে`));
    const guardian = detailItems().find(([label]) => /Father/i.test(label));
    assert(guardian, 'Father / Husband / Care Of নেই');
    assert.strictEqual(guardian[1], 'Test Guardian A', `ভুল মান → ${guardian[1]}`);
  });

  check('Today পেজের ডিটেইলসেও অপ্রয়োজনীয় কলাম নেই', () => {
    w.__state.todayRows = [{ memberCode: '001401418', memberName: 'Test Member A', centerCode: '0006', loan: 100, savings: 50, dps: 0, total: 150, date: '2026-10-20', createdAt: new Date().toISOString() }];
    w.__openTodayDetails(0);
    const shown = labels();
    NOISE.forEach((name) => assert(!shown.includes(name), `${name} দেখা যাচ্ছে`));
    assert(shown.includes('Father / Husband / Care Of'), 'পিতার নাম নেই');
  });

  check('Today পেজেও STATUS / MEMBER TYPE / INTCHARGE / NOOF* বাদ (v9.10)', () => {
    const shown = labels();
    ['STATUS', 'Status', 'MEMBER TYPE', 'Member Type', 'INTCHARGE', 'NOOFFULLPAYMENT',
      'NOOFPARTIALPAYMENT', 'NOOFNOTPAYMENT'].forEach((name) =>
      assert(!shown.includes(name), `${name} এখনো দেখা যাচ্ছে`));
  });

  check('শিরোনামহীন অগোছালো "তথ্য" কার্ড নেই (v9.10)', () => {
    const shown = labels();
    assert(!shown.includes('তথ্য'), 'শিরোনামহীন "তথ্য" কার্ড এখনো আছে');
    assert(!shown.some((t) => !t.trim()), 'ফাঁকা লেবেলের কার্ড আছে');
  });

  check('কিস্তি টেবিলে অপ্রয়োজনীয় কলাম দেখানো হয় না (আগের মতোই)', () => {
    const heads = [...$('#tbl-due').closest('table').querySelectorAll('thead th')].map((th) => th.textContent.trim());
    NOISE.forEach((name) => assert(!heads.includes(name), `${name} টেবিলে দেখা যাচ্ছে`));
    assert(heads.includes('মেম্বার কোড'), 'Member Code column missing');
  });

  console.log(results.join('\n'));
  w.close();
}, 300);
