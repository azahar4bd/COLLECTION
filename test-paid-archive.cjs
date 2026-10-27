/* আদায় কিস্তির স্থায়ী আর্কাইভ: মাস বদল, তারিখ/মাস ফিল্টার, count/subtotal, Neon upsert/remove। */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const headers = [
  'Member Code', 'Member Name', 'Center Code', 'Center Name', 'EmpName',
  'Installment Start Date', 'Installment Date Actual', 'Installment Amount', 'Installment Actual', 'LoanSummaryID',
];
const row = (code, name, center, due, paid, amount, actual, loanId, staff = 'Officer') => [
  code, name, center, `${center}, Test Center`, staff, due, paid, String(amount), String(actual), loanId,
];
const initialRows = [
  row('0000100', 'Ayesha', '001', '04-10-2026', '06-10-2026', 100, 100, 'L1', 'Officer A'),
  row('0000200', 'Bina', '002', '04-10-2026', '06-10-2026', 200, 250, 'L2', 'Officer B'),
  row('0000300', 'Chandra', '003', '04-09-2026', '28-09-2026', 300, 300, 'L3', 'Officer A'),
  row('0000400', 'Dalia', '004', '04-10-2026', '', 100, 0, 'L4', 'Officer A'),
  row('0000500', 'Ela', '005', '04-10-2026', '', 100, 50, 'L5', 'Officer B'),
  row('0000600', 'Farida', '006', '05-10-2026', '13-10-2026', 400, 400, 'L6', 'Officer B'),
];
const cloud = {
  headers, rows: initialRows, collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], todayRows: [] },
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const remote = clone(cloud);
const patches = [];
const serverMergeSource = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8')
  .replace('export function applyPatch', 'function applyPatch')
  .replace(/export \{[^}]+\};?\s*$/, '') + '\nmodule.exports = { applyPatch };';
const serverMergeModule = { exports: {} };
new Function('module', 'exports', serverMergeSource)(serverMergeModule, serverMergeModule.exports);
function mergeRemote(patch) {
  const merged = serverMergeModule.exports.applyPatch(remote, patch);
  Object.keys(remote).forEach((key) => delete remote[key]);
  Object.assign(remote, clone(merged));
}

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.confirm = () => true;
w.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  if (method === 'POST') {
    const patch = JSON.parse(options.body).patch;
    patches.push(clone(patch));
    mergeRemote(patch);
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) };
  }
  if (method === 'PUT') {
    const document = JSON.parse(options.body);
    Object.assign(remote, clone(document));
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) };
  }
  return { ok: true, status: 200, json: async () => clone(remote) };
};
/* পুরোনো Neon document-এ archive নেই, কিন্তু browser-এ একটি migration copy আছে।
   প্রথম save-এ এই রেকর্ডটিও যেতে হবে—শুধু নতুন তিনটি নয়। */
w.localStorage.setItem('collectionManager.paidArchive.v1', JSON.stringify([{
  key: 'loan:l1|member:100|due:2026-10-04|occ:0', memberCode: '0000100', memberName: 'Ayesha',
  centerCode: '001', centerName: '001, Test Center', staffName: 'Officer',
  installmentDate: '2026-10-04', paidDate: '2026-10-06', amount: 100, actual: 100,
  archivedAt: '2026-10-06T00:00:00.000Z',
}]));
w.eval(fs.readFileSync('shared/csv-rules.js', 'utf8'));
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__showPage = showPage;
window.__archive = archiveCurrentPaidInstallments;
window.__renderArchive = renderPaidArchive;
window.__applyMisFiles = applyMisFiles;
window.__misSlots = misSlots;
window.__addToday = addTodayRow;
window.__deleteToday = deleteTodayRow;
window.__startEditToday = startEditToday;
window.__clearForm = clearTodayForm;
window.__today = localDateInputValue;
window.__flush = flushOutbox;
`);

const $ = (selector) => w.document.querySelector(selector);
const $$ = (selector) => [...w.document.querySelectorAll(selector)];
const state = w.__state;
const archiveRows = () => $$('#paid-archive-list tr.paid-archive-row');
const dateTotals = () => $$('#paid-archive-list tr.paid-archive-date-total');
const change = (selector, value) => {
  const element = $(selector);
  element.value = value;
  element.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const byLoan = (loanId) => state.paidArchive.find((item) => item.key.startsWith(`loan:${loanId.toLowerCase()}|`));
const bnNumber = (value) => Number(String(value).replace(/[০-৯]/g, (digit) => '০১২৩৪৫৬৭৮৯'.indexOf(digit)).replace(/[^0-9.]/g, ''));

setTimeout(async () => {
  // New pages render lazily; this legacy multi-table suite explicitly opens the all-tables view.
  w.__showPage('installments');
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`✅ ${name}`); }
    catch (error) { results.push(`❌ ${name} → ${error.message}`); process.exitCode = 1; }
  };

  await check('প্রথম লোডে শুধু সম্পূর্ণ আদায়ের ৪টি সারি archive হয়', () => {
    assert.strictEqual(state.paidArchive.length, 4);
    assert.strictEqual(archiveRows().length, 4);
    assert.strictEqual(new Set(state.paidArchive.map((item) => item.key)).size, 4);
    assert(patches.some((patch) => patch.paidArchiveUpserts?.length === 4), 'browser copyসহ প্রথম migration patch পাওয়া যায়নি');
    assert.strictEqual(remote.dailyData.paidArchive.length, 4, 'পুরোনো browser copy Neon-এ যায়নি');
  });

  await check('কিস্তির তারিখ ও আসল আদায়ের তারিখ আলাদা সংরক্ষিত', () => {
    const item = byLoan('L1');
    assert.strictEqual(item.installmentDate, '2026-10-04');
    assert.strictEqual(item.paidDate, '2026-10-06');
    assert.strictEqual(item.amount, 100);
    assert.strictEqual(item.actual, 100);
  });

  await check('একই current রিপোর্ট বারবার sync করলে ডুপ্লিকেট হয় না', () => {
    assert.strictEqual(w.__archive(), false);
    assert.strictEqual(w.__archive(), false);
    assert.strictEqual(state.paidArchive.length, 4);
  });

  await check('স্থায়ী আর্কাইভ আদায় কিস্তির বাইরে পেজের সবার নিচে আলাদা তালিকা', () => {
    const archiveCard = $('#sec-paid-archive');
    assert(archiveCard, 'আলাদা archive card নেই');
    assert(!$('#sec-paid').contains(archiveCard), 'archive এখনো আদায় কিস্তির ভেতরে আছে');
    const sections = $$('[data-sec]');
    assert.strictEqual(sections[sections.length - 1].id, 'sec-paid-archive');
    assert($('#section-view-filter option[value="paid-archive"]'), 'তালিকা-নির্বাচকে archive নেই');
    assert(archiveCard.querySelector('[data-collapse="sec-paid-archive"]'), 'আলাদা collapse control নেই');
  });

  await check('ষ্টাফ + মাস + আদায়ের তারিখ একসাথে archive ফিল্টার করে', () => {
    change('#f-staff', 'Officer A');
    assert.strictEqual(archiveRows().length, 2);
    assert.deepStrictEqual(archiveRows().map((tr) => tr.children[4].textContent), ['Ayesha', 'Chandra']);
    assert($('#paid-archive-filter-label').textContent.includes('Officer A'));
    change('#paid-archive-month', '2026-10');
    assert.strictEqual(archiveRows().length, 1);
    assert.strictEqual(archiveRows()[0].children[4].textContent, 'Ayesha');
    change('#paid-archive-date', '2026-10-06');
    assert.strictEqual(archiveRows().length, 1);
    assert.strictEqual($('#count-paid-archive').textContent, '১');
    change('#f-staff', '');
    $('#btn-clear-paid-archive').click();
    assert.strictEqual(archiveRows().length, 4);
  });

  await check('অক্টোবর ফিল্টারে ৩টি কিস্তি ও ২টি তারিখের subtotal', () => {
    change('#paid-archive-month', '2026-10');
    assert.strictEqual(archiveRows().length, 3);
    assert.strictEqual(dateTotals().length, 2);
    assert.strictEqual($('#count-paid-archive').textContent, '৩');
    const october6 = dateTotals().find((tr) => tr.dataset.dateTotal === '2026-10-06');
    assert(october6.textContent.includes('২টি কিস্তি'), october6.textContent);
    const cells = october6.querySelectorAll('td');
    assert.strictEqual(bnNumber(cells[1].textContent), 300);
    assert.strictEqual(bnNumber(cells[2].textContent), 350);
  });

  await check('নির্দিষ্ট আদায়ের তারিখে কোন কিস্তি ও মোট কতটি—সঠিক', () => {
    change('#paid-archive-date', '2026-10-06');
    assert.strictEqual(archiveRows().length, 2);
    assert.strictEqual($('#paid-archive-month').value, '');
    const names = archiveRows().map((tr) => tr.children[4].textContent).sort();
    assert.deepStrictEqual(names, ['Ayesha', 'Bina']);
    const grand = $('.paid-archive-grand-total');
    assert(grand.textContent.includes('২টি কিস্তি'), grand.textContent);
    assert.strictEqual(bnNumber(grand.children[1].textContent), 300);
    assert.strictEqual(bnNumber(grand.children[2].textContent), 350);
  });

  await check('নতুন মাসের রিপোর্ট replace করলেও পুরোনো আদায় থাকে; current paid আলাদা', async () => {
    change('#paid-archive-date', '');
    const novemberRows = [
      row('0000700', 'Gita', '007', '01-11-2026', '03-11-2026', 500, 500, 'L7'),
      row('0000800', 'Hena', '008', '01-11-2026', '', 600, 0, 'L8'),
    ];
    w.__misSlots.installment = { rows: [headers, ...novemberRows] };
    await w.__applyMisFiles();
    assert.strictEqual(state.rows.length, 2);
    assert.strictEqual($$('#tbl-paid tr').length, 1, 'current paid তালিকা নতুন রিপোর্টের নয়');
    assert.strictEqual(state.paidArchive.length, 5, 'পুরোনো ৪ + নতুন ১ archive নেই');
    assert(byLoan('L1') && byLoan('L3') && byLoan('L7'));
    const lastPatch = patches[patches.length - 1];
    assert.strictEqual(lastPatch.paidArchiveUpserts.length, 1, 'শুধু নতুন archive record upsert হয়নি');
    assert.strictEqual(lastPatch.paidArchiveUpserts[0].memberName, 'Gita');
  });

  await check('চলতি রিপোর্টে না থাকা পুরোনো staff দিয়েও archive ফিল্টার চলে', () => {
    const staffOptions = [...$('#f-staff').options].map((option) => option.value);
    assert(staffOptions.includes('Officer A') && staffOptions.includes('Officer B'), staffOptions.join('|'));
    change('#f-staff', 'Officer A');
    assert.strictEqual(archiveRows().length, 2);
    assert.deepStrictEqual(archiveRows().map((tr) => tr.children[4].textContent), ['Ayesha', 'Chandra']);
    change('#f-staff', '');
    assert.strictEqual(archiveRows().length, 5);
  });

  await check('নতুন মাস ও পুরোনো মাস আলাদাভাবে ফিল্টার করা যায়', () => {
    change('#paid-archive-month', '2026-11');
    assert.strictEqual(archiveRows().length, 1);
    assert.strictEqual(archiveRows()[0].children[4].textContent, 'Gita');
    change('#paid-archive-month', '2026-09');
    assert.strictEqual(archiveRows().length, 1);
    assert.strictEqual(archiveRows()[0].children[4].textContent, 'Chandra');
  });

  await check('Today থেকে পুরো কিস্তি এলে আজকের আদায়-তারিখসহ archive যোগ হয়', async () => {
    change('#paid-archive-month', '');
    w.__clearForm();
    $('#today-member-code').value = '0000800';
    $('#today-member-name').value = 'Hena';
    $('#today-loan').value = '600';
    await w.__addToday();
    await w.__flush();
    const item = byLoan('L8');
    assert(item, 'নতুন আদায় archive হয়নি');
    assert.strictEqual(item.paidDate, w.__today());
    assert.strictEqual(item.installmentDate, '2026-11-01');
    assert.strictEqual(item.actual, 600);
    assert.strictEqual(state.paidArchive.length, 6);
    assert.strictEqual(patches[patches.length - 1].paidArchiveUpserts.length, 1);
  });

  await check('Today এন্ট্রি এডিটের পরও archive ও আদায়-তারিখ সঠিক থাকে', async () => {
    w.__startEditToday(0);
    $('#today-savings').value = '10';
    $('#today-savings').dispatchEvent(new w.Event('input', { bubbles: true }));
    await w.__addToday();
    await w.__flush();
    assert.strictEqual(state.todayRows.length, 1);
    assert.strictEqual(state.todayRows[0].savings, 10);
    assert.strictEqual(byLoan('L8').paidDate, w.__today());
    assert.strictEqual(state.paidArchive.length, 6);
  });

  await check('এডিটকৃত Today এন্ট্রি ডিলিটে আদায় বাতিল; শুধু ওই archive key remove হয়', async () => {
    const removedKey = byLoan('L8').key;
    await w.__deleteToday(0);
    await w.__flush();
    assert.strictEqual(byLoan('L8'), undefined);
    assert.strictEqual(state.paidArchive.length, 5);
    assert.strictEqual(state.rows[1][8], '0');
    assert.strictEqual(state.rows[1][6], '');
    const lastPatch = patches[patches.length - 1];
    assert.deepStrictEqual(lastPatch.paidArchiveRemoveKeys, [removedKey]);
    assert(byLoan('L1') && byLoan('L7'), 'অন্য archive রেকর্ড মুছে গেছে');
  });

  await check('ফিল্টার মুছে সব মাসের ৫টি রেকর্ড ও সর্বমোট ফিরে আসে', () => {
    $('#btn-clear-paid-archive').click();
    assert.strictEqual(archiveRows().length, 5);
    assert.strictEqual($('#count-paid-archive').textContent, '৫');
    assert($('.paid-archive-grand-total').textContent.includes('৫টি কিস্তি'));
  });

  await check('Netlify patch: অন্য ডিভাইসের রেকর্ড রেখে upsert/remove merge হয়', () => {
    const mergeSource = fs.readFileSync('netlify/functions/sync-merge.mjs', 'utf8')
      .replace('export function applyPatch', 'function applyPatch')
      .replace(/export \{[^}]+\};?\s*$/, '');
    const source = mergeSource + '\n' + fs.readFileSync('netlify/functions/data.js', 'utf8')
      .replace(/^import[^\n]*\n/gm, '')
      .replace('export const handler', 'const handler')
      + '\nmodule.exports = { applyPatch, validDailyData };';
    const serverModule = { exports: {} };
    new Function('module', 'exports', 'process', 'Buffer', source)(serverModule, serverModule.exports, process, Buffer);
    const { applyPatch, validDailyData } = serverModule.exports;
    const record = (key, name, actual = 100) => ({
      key, memberCode: key, memberName: name, centerCode: '001', centerName: 'Center', staffName: 'Officer',
      installmentDate: '2026-10-04', paidDate: '2026-10-06', amount: 100, actual, archivedAt: '2026-10-23T00:00:00.000Z',
    });
    const dailyData = { memberDBHeaders: [], memberDB: [], balanceHeaders: [], balanceRows: [], todayRows: [], paidArchive: [record('a', 'A'), record('b', 'B')] };
    const base = { dailyData };
    assert.strictEqual(validDailyData(dailyData), true);
    const merged = applyPatch(base, { paidArchiveUpserts: [record('a', 'A updated', 125), record('c', 'C')] });
    assert.deepStrictEqual(merged.dailyData.paidArchive.map((item) => item.key), ['a', 'b', 'c']);
    assert.strictEqual(merged.dailyData.paidArchive[0].actual, 125);
    assert.strictEqual(merged.dailyData.paidArchive[1].memberName, 'B', 'অন্য ডিভাইসের B হারিয়েছে');
    assert.strictEqual(base.dailyData.paidArchive.length, 2, 'মূল object mutate হয়েছে');
    const removed = applyPatch(merged, { paidArchiveRemoveKeys: ['a'] });
    assert.deepStrictEqual(removed.dailyData.paidArchive.map((item) => item.key), ['b', 'c']);
    assert.strictEqual(validDailyData({ ...dailyData, paidArchive: [{ memberName: 'bad' }] }), false);
    const sandbox = fs.readFileSync('sandbox-server.mjs', 'utf8');
    assert(sandbox.includes('sync-merge.mjs') && mergeSource.includes('patch.paidArchiveUpserts') && mergeSource.includes('patch.paidArchiveRemoveKeys'), 'sandbox patch parity নেই');
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 600);
