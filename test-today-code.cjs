/* Today All Collection পেজে শেষের ৪/৩ সংখ্যা দিয়ে সদস্য খোঁজা ও সেভ যাচাই। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code', 'Mobile'];
const memberDB = [
  ['0000123', 'Zara Member', '101', '01711000000'],
  ['0000456', 'Alpha Member', '102', '01722000000'],
];

let saved = null;
const cloud = {
  headers: ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'],
  rows: [['0000123', 'Zara Member', '101', 'Collector A', '1000', '0']],
  collections: [], followups: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
/* ছোট নকল সার্ভার — PUT পুরো ডকুমেন্ট, POST শুধু বদলানো অংশ (প্যাচ) */
function fakeServer(doc, body) {
  const parsed = JSON.parse(body);
  if (!parsed.patch) return parsed;
  const patch = parsed.patch;
  const next = { ...doc };
  if (patch.headers) next.headers = patch.headers;
  if (patch.rows) next.rows = patch.rows;
  if (patch.rowUpdates) { const r = [...next.rows]; patch.rowUpdates.forEach(([i, cells]) => { r[i] = cells; }); next.rows = r; }
  if (patch.collections) next.collections = patch.collections;
  if (patch.followups) next.followups = patch.followups;
  if (patch.history) next.history = patch.history;
  next.dailyData = { ...(next.dailyData || {}) };
  if (patch.todayRows) next.dailyData.todayRows = patch.todayRows;
  if (patch.memberDB) next.dailyData.memberDB = patch.memberDB.rows;
  if (patch.balance) next.dailyData.balanceRows = patch.balance.rows;
  return next;
}
w.fetch = async (url, options) => {
  if (options && (options.method === 'PUT' || options.method === 'POST')) {
    saved = fakeServer(saved || cloud, options.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) };
  }
  if (String(url).includes('meta=1')) return { ok: true, status: 200, json: async () => ({ updated_at: null, counts: {} }) };
  return { ok: true, status: 200, json: async () => cloud };
};
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__addTodayRow = addTodayRow;
window.__renderMemberDatabaseTable = renderMemberDatabaseTable;
`);

const $ = (sel) => w.document.querySelector(sel);
const $$ = (sel) => [...w.document.querySelectorAll(sel)];

setTimeout(async () => {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };

  await check('শেষের ৪ সংখ্যা লিখে সদস্যের নাম/সেন্টার অটো-ফিল', () => {
    $('#today-member-code').value = '0123';
    $('#today-member-code').dispatchEvent(new w.Event('input'));
    assert.strictEqual($('#today-member-name').value, 'Zara Member', 'নাম ফিল হয়নি');
    assert.strictEqual($('#today-center-code').value, '101', 'সেন্টার কোড শেষের ৩ সংখ্যা নয়');
  });

  await check('মূল কোড সেভ হয় (শেষের ৪ সংখ্যা নয়)', async () => {
    $('#today-loan').value = '250';
    await w.__addTodayRow();
    assert.strictEqual(w.__state.todayRows.length, 1, 'এন্ট্রি যোগ হয়নি');
    assert.strictEqual(w.__state.todayRows[0].memberCode, '0000123', 'মূল কোড সেভ হয়নি');
    assert.strictEqual(w.__state.todayRows[0].centerCode, '101', 'সেন্টার কোড সেভ হয়নি');
    assert(saved && saved.dailyData.todayRows.length === 1, 'Neon-এ সেভ হয়নি');
  });

  await check('Today তালিকায় শেষের ৪/৩ সংখ্যা দেখায়', () => {
    const cells = $$('#today-monthly-list tr.today-row').map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    assert.strictEqual(cells.length, 1, `মাসিক টেবিলে সারি ${cells.length}`);
    assert.strictEqual(cells[0][1], '0123', `মেম্বার কোড = ${cells[0][1]}`);
    assert.strictEqual(cells[0][2], '101', `সেন্টার কোড = ${cells[0][2]}`);
  });

  await check('Today পেজে আদায় নিলে কিস্তি সারিতে আদায় বসে (বাকী → আংশিক)', () => {
    const rows = w.__state.rows;
    assert.strictEqual(String(rows[0][5]), '250', `Installment Actual = ${rows[0][5]}`);
    const partial = $$('#tbl-partial tr').map((tr) => tr.querySelectorAll('td')[1].textContent.trim());
    const due = $$('#tbl-due tr').map((tr) => tr.querySelectorAll('td')[1].textContent.trim());
    assert.ok(partial.includes('Zara Member'), 'আংশিক কিস্তিতে যায়নি');
    assert.ok(!due.includes('Zara Member'), 'বাকী কিস্তিতে এখনো আছে');
  });

  await check('ডাটাবেজ তালিকায় শেষের ৪/৩ সংখ্যা', () => {
    w.__renderMemberDatabaseTable();
    const codes = $$('#member-db-list tr').map((tr) => tr.querySelector('td').textContent.trim());
    assert.deepStrictEqual(codes, ['0123', '0456'], codes.join(','));
  });

  console.log(results.join('\n'));
  w.close();
}, 300);
