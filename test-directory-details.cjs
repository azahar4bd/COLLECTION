/* যাচাই: কিস্তি/আদায় তালিকার ডিটেইলসে সদস্য ডাটাবেজ (Today All Collection) থেকে
   Father / Husband / Care Ofসহ অতিরিক্ত তথ্য আসে কি না। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['001401418', 'Test Member A', '0006', 'Rahima Akter', '1200', '0'],
  ['001402340', 'Test Member B', '0017', 'Rahima Akter', '1500', '500'],
];

// সদস্য ডাটাবেজ — Today All Collection পেজের 📁 CSV আপলোড থেকে আসা (Father / Husband / Care Of কলাম সহ)
const memberDBHeaders = ['Sl. No.', '', 'Center Code & Name', 'Member No', '', 'Member Name', '', 'Contact Number', 'Father / Husband / Care Of', 'Age', 'Joining  Date', '', 'Pre Member Code', '', '', 'Drop Out Date', 'Status', 'Member Type', '', ''];
const memberDB = [
  ['1', '', '0006, GOBRA BAZ', '001401418', '', ' Test Member A', '', '01711000001', 'Test Guardian A', '42', '27-Aug-2006', '', '', '', '', '01-Jan-1900', 'Active', 'Member', '', ''],
  ['2', '', '0017, PACHURIA', '001402340', '', ' Test Member B', '', '01711000002', 'Test Guardian B', '51', '15-Jan-2007', '', '', '', '', '01-Jan-1900', 'Active', 'Member', '', ''],
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
window.__mergeDirectoryDetails = mergeDirectoryDetails;
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
  const detailItems = () => $$('#member-detail-grid .detail-item').map((el) => [el.querySelector('span').textContent.trim(), el.querySelector('strong').textContent.trim()]);
  const findItem = (needle) => detailItems().find(([label]) => label.toLowerCase().includes(needle));

  check('কিস্তি তালিকার সারিতে ক্লিক করলে ডিটেইলস মোডাল খোলে', () => {
    const tr = $$('#tbl-due tr').find((row) => row.textContent.includes('Test Member A'));
    assert(tr, 'কিস্তি সারি পাওয়া যায়নি');
    tr.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert(!$('#member-details-modal').classList.contains('hidden'), 'মোডাল খোলেনি');
  });

  check('ডিটেইলসে ডাটাবেজের Father / Husband / Care Of আসে', () => {
    const item = findItem('father');
    assert(item, 'Father / Husband / Care Of আইটেম পাওয়া যায়নি');
    assert.strictEqual(item[1], 'Test Guardian A', `ভুল মান → ${item[1]}`);
  });

  check('ডিটেইলসে ডাটাবেজ থেকে আসা দরকারি কলাম আসে (বয়স, জয়েনিং তারিখ)', () => {
    const age = findItem('age');
    assert(age, 'বয়স পাওয়া যায়নি');
    assert.strictEqual(age[1], '42', `বয়স ভুল → ${age[1]}`);
    const joining = findItem('joining');
    assert(joining, 'জয়েনিং তারিখ পাওয়া যায়নি');
  });

  check('Status ও Member Type আর দেখানো হয় না (v9.9)', () => {
    assert(!findItem('status'), 'Status এখনো দেখাচ্ছে');
    assert(!findItem('membertype'), 'Member Type এখনো দেখাচ্ছে');
  });

  check('ডাটাবেজ তথ্য আলাদা হেডিং দিয়ে আলাদা করা হয়েছে', () => {
    const divider = [...$('#member-detail-grid').querySelectorAll('.detail-divider')]
      .find((el) => /ডাটাবেজ|database/i.test(el.textContent));
    assert(divider, 'ডিভাইডার নেই');
  });

  check('ডাটাবেজ থেকে আসা অংশে কোড/নাম/মোবাইল ডুপ্লিকেট হয় না', () => {
    const kids = [...$('#member-detail-grid').children];
    const dividerAt = kids.findIndex((el) => el.classList.contains('detail-divider') && /ডাটাবেজ|database/i.test(el.textContent));
    assert(dividerAt >= 0, 'ডিভাইডার নেই');
    const dbLabels = kids.slice(dividerAt + 1)
      .filter((el) => el.classList.contains('detail-item'))
      .map((el) => el.querySelector('span').textContent.trim().toLowerCase());
    assert(!dbLabels.some((l) => l.includes('member name')), 'সদস্যের নাম ডুপ্লিকেট');
    assert(!dbLabels.some((l) => l.includes('member no')), 'মেম্বার কোড ডুপ্লিকেট');
    assert(!dbLabels.some((l) => l.includes('contact number')), 'মোবাইল ডুপ্লিকেট');
    assert(!dbLabels.some((l) => l.includes('sl.')), 'স্ল. নম্বর দেখানো উচিত নয়');
    assert(!dbLabels.some((l) => l.includes('center code & name')), 'সেন্টার ডুপ্লিকেট');
  });

  check('ইনস্টলমেন্ট সারিতে সেন্টার কলাম না থাকলে ডাটাবেজ থেকে সেন্টার কোড ও নাম আসে', () => {
    const merged = w.__mergeDirectoryDetails([{ label: 'Member Code', value: '001401418' }], '001401418', '');
    const center = merged.entries.find((e) => /^সেন্টার কোড$/.test(e.label));
    assert(center, 'সেন্টার কোড আসেনি');
    assert.strictEqual(center.value, '006', `সেন্টার কোড ভুল → ${center.value}`);
    const name = merged.entries.find((e) => /সেন্টারের নাম|Center name/.test(e.label));
    assert(name, 'Center name missing');
    assert.strictEqual(name.value, 'GOBRA BAZ', `সেন্টারের নাম ভুল → ${name.value}`);
  });

  check('ইনস্টলমেন্ট সারিতে মোবাইল না থাকলে ডাটাবেজের মোবাইল দিয়ে কল বাটন', () => {
    const call = $('#member-call-action a');
    assert(call, 'কল বাটন নেই');
    assert(call.getAttribute('href') === 'tel:01711000001', `কল লিংক ভুল → ${call.getAttribute('href')}`);
  });

  check('ইনস্টলমেন্ট CSV-তেই পিতার নাম থাকলে সেটিই দেখায় (ডুপ্লিকেট নয়)', () => {
    const s = w.__state;
    s.headers = ['Member Code', 'Member Name', 'Center Code', 'Father / Husband / Care Of'];
    s.rows = [['001401418', 'Test Member A', '0006', 'নিজের কলামের নাম']];
    s.detect = { memberCode: 0, memberName: 1, centerCode: 2, mobile: -1, amount: -1, actual: -1 };
    w.__openMemberDetailsFromRow(0);
    const items = detailItems();
    const guardians = items.filter(([label]) => label.toLowerCase().includes('father'));
    assert.strictEqual(guardians.length, 1, `পিতার আইটেম ${guardians.length}টি`);
    assert.strictEqual(guardians[0][1], 'নিজের কলামের নাম', `ভুল মান → ${guardians[0][1]}`);
  });

  check('শেষ ৪ সংখ্যার কোড দিয়েও ডাটাবেজ মিলে', () => {
    const merged = w.__mergeDirectoryDetails([{ label: 'Member Code', value: '1418' }], '1418', '0006');
    assert(merged.matched, 'শেষ ৪ সংখ্যায় মিলেনি');
    const guardian = merged.entries.find((e) => /father/i.test(e.label || ''));
    assert(guardian, 'Father / Husband / Care Of আসেনি');
    assert.strictEqual(guardian.value, 'Test Guardian A', `ভুল মান → ${guardian.value}`);
  });

  check('কোনো মিল না থাকলে ডিটেইলস ঠিক থাকে (ক্র্যাশ নয়) ও ইঙ্গিত দেখায়', () => {
    const merged = w.__mergeDirectoryDetails([{ label: 'Member Code', value: '999999' }], '999999', '9999');
    assert.strictEqual(merged.matched, false, 'ভুল করে মিলেছে');
    assert.strictEqual(merged.entries.length, 2, 'অতিরিক্ত এন্ট্রি যোগ হয়েছে');
    const hint = merged.entries.find((entry) => entry.hint);
    assert(hint, 'ইঙ্গিত নেই');
    assert(/active contact list/.test(hint.label), 'hint text wrong');
  });

  console.log(results.join('\n'));
  w.close();
}, 300);
