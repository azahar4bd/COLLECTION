/* যাচাই: "আজ প্রতিশ্রুতি" = বাকী কিস্তির মধ্যে যাদের প্রতিশ্রুতির তারিখ আজ।
   Paid/partial-এর followup সংরক্ষিত থাকলেও এই তালিকায় আসবে না। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['SLNo', 'OfficeID', 'OfficeCode', 'OfficeName', 'EmpName', 'CenterCode', 'CenterName',
  'MemberCode', 'MemberName', 'ProductCode', 'ProductName', 'MainProductCode', 'MainItemName',
  'EmployeeCode', 'PhoneNo', 'DisburseDate', 'PrincipalLoan', 'Duration', 'MonthPassed', 'LBalance',
  'SCBalance', 'InstallmentStartDate', 'InstallmentAmount', 'InstallmentDateActual', 'InstallmentActual',
  'Remarks', 'LoanSummaryID', 'IntCharge', 'NoOfFullPayement', 'NoOfPartialPayement', 'NoOfNotPayement'];

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const tomorrow = new Date(now.getTime() + 86400000);
const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
const todayDMY = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;

const mk = (sl, code, name, date, actual) => [String(sl), '35', '14', 'GOBRA BRANCH', 'AZAZ SAKIB', '001', '0001, GOBRA BAZAR',
  code, name, '30.03', '30.03, Agrasor-MFCE-1.5Yrs/M', '1086', 'Agrasor-MFCE Loan', '1994', '01711000001',
  '4/5/2026', '350000', '18', '4', '272232', '39478', date, '1000', '', actual, '', '552038', '3368.87', '0', '0', '1'];

const rows = [
  mk(1, '1405801', 'আজ বাকী', todayDMY, '0'),          // আজ + বাকী  → আজ প্রতিশ্রুতিতে থাকবে
  mk(2, '1405802', 'আজ পরিশোধিত', todayDMY, '1000'),   // আজ + আদায় → থাকবে না
  mk(3, '1405803', 'আগামী বাকী', tomorrowStr, '0'),     // আগামী      → থাকবে না
  mk(4, '1405804', 'গতকাল বাকী', '2026-10-19', '0'),     // গতকাল      → থাকবে না
  mk(5, '1405805', 'আজ আংশিক', todayDMY, '400'),       // আজ + আংশিক → প্রতিশ্রুতি তালিকায় থাকবে না
];

const cloud = {
  headers, rows, collections: [],
  // Paid/partial-এর আজকের followup-ও রাখা হয়েছে—তারা বাকী তালিকায় না থাকায় দেখা যাবে না।
  followups: [
    { key: 'code:1405801', promise: 'আজই আসবেন', nextDate: today, givenDate: today, memberCode: '1405801', memberName: 'আজ বাকী' },
    { key: 'code:1405802', promise: 'পরিশোধিত সদস্যের নোট', nextDate: today, givenDate: today, memberCode: '1405802', memberName: 'আজ পরিশোধিত' },
    { key: 'code:1405803', promise: 'শনিবার', nextDate: tomorrowStr, givenDate: today, memberCode: '1405803', memberName: 'আগামী বাকী' },
    { key: 'code:1405804', promise: 'গতকাল', nextDate: '2026-10-19', givenDate: today, memberCode: '1405804', memberName: 'গতকাল বাকী' },
    { key: 'code:1405805', promise: 'আংশিক সদস্যের নোট', nextDate: today, givenDate: today, memberCode: '1405805', memberName: 'আজ আংশিক' },
  ],
  dailyData: { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__showPage = showPage;
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
  const promiseNames = () => [...$('#tbl-today-promise').querySelectorAll('tr')]
    .map((tr) => tr.querySelectorAll('td')[1]?.textContent.trim()).filter(Boolean);
  const dueNames = () => [...$('#tbl-due').querySelectorAll('tr')]
    .map((tr) => tr.querySelectorAll('td')[1]?.textContent.trim()).filter(Boolean);

  check('আজ প্রতিশ্রুতিতে শুধু যাদের প্রতিশ্রুতির তারিখ = আজ', () => {
    const names = promiseNames();
    assert.deepStrictEqual(names, ['আজ বাকী'], `পাওয়া গেল: ${JSON.stringify(names)}`);
  });

  check('প্রতিশ্রুতি তালিকা সবসময় বাকী কিস্তির subset; paid/partial বাদ', () => {
    const promised = promiseNames();
    const due = dueNames();
    assert.ok(promised.every((name) => due.includes(name)), `বাকীর বাইরের নাম: ${JSON.stringify(promised.filter((name) => !due.includes(name)))}`);
    assert.ok(!promised.includes('আজ পরিশোধিত'), 'পরিশোধিত সদস্য প্রতিশ্রুতিতে আছে');
    assert.ok(!promised.includes('আজ আংশিক'), 'আংশিক সদস্য প্রতিশ্রুতিতে আছে');
  });

  check('প্রতিশ্রুতির তারিখ আজ নয় (আগামী/গতকাল) — তারা এই তালিকায় আসে না', () => {
    const names = promiseNames();
    assert.ok(!names.includes('আগামী বাকী'), 'আগামী তারিখের প্রতিশ্রুতি ঢুকে গেছে');
    assert.ok(!names.includes('গতকাল বাকী'), 'গতকালের প্রতিশ্রুতি ঢুকে গেছে');
    assert.ok(!names.includes('আজ আংশিক'), 'প্রতিশ্রুতি না থাকা সদস্য ঢুকে গেছে');
  });

  check('Today promise badge = 1', () => {
    const badge = $('#count-today-promise').textContent.trim().replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
    assert.strictEqual(badge, '1', `ব্যাজ = ${$('#count-today-promise').textContent.trim()}`);
  });

  check('বাকী কিস্তি তালিকায় আজ + আগামী + গতকাল — তিনটিই আছে', () => {
    const names = dueNames();
    assert.ok(names.includes('আজ বাকী'), 'আজ বাকী নেই');
    assert.ok(names.includes('আগামী বাকী'), 'আগামী বাকী নেই');
    assert.ok(names.includes('গতকাল বাকী'), 'গতকাল বাকী নেই');
    assert.ok(!names.includes('আজ পরিশোধিত'), 'আদায় হওয়া সারি বাকী তালিকায় থাকা উচিত নয়');
  });

  check('শিরোনামে আজকের তারিখ দেখাচ্ছে (dd-mm-yy)', () => {
    const label = $('#today-promise-date').textContent.trim();
    const d = now.getDate(), m = now.getMonth() + 1;
    assert.ok(label.includes(`${pad(d)}-${pad(m)}-${String(now.getFullYear()).slice(2)}`), `লেবেল = ${label}`);
  });

  check('Empty state mentions promise', () => {
    const text = $('#empty-today-promise').textContent;
    assert.ok(/প্রতিশ্রুতি/.test(text), `text = ${text}`);
  });

  check('Promise next date shown as dd-mm-yy', () => {
    const cell = $('#tbl-today-promise').querySelector('.followup-cell small');
    assert.ok(cell, 'পরবর্তী তারিখ দেখাচ্ছে না');
    assert.ok(/^\d{2}-\d{2}-\d{2}$/.test(cell.textContent.replace('📅', '').trim()), `তারিখ = ${cell.textContent.trim()}`);
  });

  check('তারিখ কলাম dd-mm-yy ফরম্যাটে দেখাচ্ছে', () => {
    const cells = [...$('#tbl-today-promise').querySelectorAll('tr')].map((tr) => tr.querySelectorAll('td')[5]?.textContent.trim());
    assert.ok(/^\d{2}-\d{2}-\d{2}$/.test(cells[0] || ''), `তারিখ কলাম = ${cells[0]}`);
  });

  check('প্রতিশ্রুতির লেখা 14px soft note-এ natural wrap; পূর্ণ লেখা ও তারিখ অক্ষত', () => {
    const note = $('#tbl-today-promise .followup-preview');
    assert.ok(note, 'প্রতিশ্রুতির note পাওয়া যায়নি');
    assert.ok(note.textContent.includes('আজই আসবেন'), 'মূল প্রতিশ্রুতির লেখা বদলেছে');
    assert.ok(note.querySelector('small'), 'তারিখের আলাদা badge নেই');
    const css = fs.readFileSync('styles.css', 'utf8');
    const noteCss = css.slice(css.lastIndexOf('/* ===== v9.31'));
    assert.ok(noteCss.includes('.followup-preview'));
    assert.ok(noteCss.includes('font-size: 14px'));
    assert.ok(noteCss.includes('white-space: normal'));
    assert.ok(noteCss.includes('border-radius: 10px'));
    assert.ok(noteCss.includes('border-left: 4px solid'));
    assert.ok(!noteCss.includes('text-overflow: ellipsis'));
    assert.ok(!noteCss.includes('overflow-wrap: anywhere'));
    assert.ok(!noteCss.includes('overflow-wrap: break-word'));
    assert.ok(!noteCss.includes('word-break: break-all'));
    assert.ok(!noteCss.includes('line-clamp'));
  });

  check('মূল পেজে (ঘর) আজ প্রতিশ্রুতি ব্লক নেই — শুধু কিস্তি তালিকা পেজে আছে', () => {
    assert.ok(!$('#sec-today-promise-home'), 'ঘরে আজ প্রতিশ্রুতি ব্লক এখনো আছে');
    assert.ok(!$('#table-today-promise-home'), 'ঘরের টেবিল এখনো আছে');
    assert.ok($('#sec-today-promise'), 'কিস্তি পেজে ব্লক নেই');
  });

  check('প্রতিশ্রুতি ঘরে নিজে থেকে কোনো তারিখ বসানো হয় না', () => {
    const marks = w.document.querySelectorAll('.due-today-mark').length;
    assert.strictEqual(marks, 0, `নিজে থেকে বসানো তারিখ-মার্ক আছে: ${marks}`);
    const cells = [...$('#tbl-today-promise').querySelectorAll('.followup-cell')];
    assert.ok(cells.length >= 1, 'প্রতিশ্রুতি ঘর নেই');
    for (const c of cells) {
      assert.ok(!c.textContent.includes('লিখুন') || c.textContent.includes('সম্পাদনা') || c.textContent.includes('আজই আসবেন'), `কেনা তারিখ ঢুকে গেছে: ${c.textContent.trim()}`);
    }
    assert.ok(cells[0].textContent.includes('আজই আসবেন'), 'ইউজারের লেখা প্রতিশ্রুতি দেখাচ্ছে না');
  });

  check('আজ প্রতিশ্রুতি টেবিলের 📝 বাটনে ম্যানুয়াল প্রতিশ্রুতি মডাল খোলে', () => {
    const btn = $('#tbl-today-promise .followup-btn');
    assert.ok(btn, 'প্রতিশ্রুতি বাটন নেই');
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    const modal = $('#followup-modal');
    assert.ok(modal && !modal.classList.contains('hidden'), 'প্রতিশ্রুতি মডাল খোলেনি');
    assert.ok($('#followup-member').textContent.trim().length > 0, 'মডালে সদস্যের নাম নেই');
    modal.querySelector('[data-close]').click();
  });

  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  process.exit(failed ? 1 : 0);
}, 2500);
