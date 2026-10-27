/* নতুন প্রবাহ: Today All Collection পেজ থেকে আদায় → কিস্তি তালিকায় বাকী/আংশিক → আদায় কিস্তি
   + Today পেজে দুই টেবিল (মাসিক / অন্যান্য) + রিসেট করলে অঙ্ক ফিরে আসে। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code'];
const memberDB = [
  ['0000123', 'Zara Member', '101'],
  ['0000456', 'Alpha Member', '102'],
  ['0000999', 'Other Woman', '103'],   // কিস্তি তালিকায় নেই → অন্যান্য
];
const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['0000123', 'Zara Member', '101', 'Collector A', '1000', '0'],
  ['0000456', 'Alpha Member', '102', 'Collector A', '1000', '0'],
];

let saved = null;
const cloud = { headers, rows, collections: [], followups: [], dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] } };

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
window.__closeTodayAccount = closeTodayAccount;
window.__fillTodayMember = fillTodayMember;
`);

const $ = (sel) => w.document.querySelector(sel);
const $$ = (sel) => [...w.document.querySelectorAll(sel)];
const names = (sel) => $$(sel + ' tr').map((tr) => tr.querySelectorAll('td')[1]?.textContent.trim()).filter(Boolean);
const todayNames = (sel) => $$(sel + ' tr.today-row').map((tr) => tr.querySelectorAll('td')[3]?.textContent.trim()).filter(Boolean);

setTimeout(async () => {
  const bn2en=(t)=>String(t).replace(/[০-৯]/g,(d)=>'০১২৩৪৫৬৭৮৯'.indexOf(d));
const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };

  await check('কোড লিখলেই বাকী অঙ্ক লোন ঘরে বসে যায়', () => {
    $('#today-member-code').value = '0123';
    w.__fillTodayMember();
    assert.strictEqual($('#today-loan').value, '1000', `লোন = ${$('#today-loan').value}`);
  });

  await check('কিস্তি তালিকার সদস্য → মাসিক টেবিলে যায়', async () => {
    $('#today-loan').value = '400';
    await w.__addTodayRow();
    assert.deepStrictEqual(todayNames('#today-monthly-list'), ['Zara Member'], 'মাসিক টেবিলে নেই');
    assert.deepStrictEqual(todayNames('#today-other-list'), [], 'অন্যান্য টেবিলে ঢুকে গেছে');
    assert.strictEqual(bn2en($('#count-today-monthly').textContent.trim()), '1', 'monthly count wrong');
  });

  await check('আদায় বসে কিস্তি সারিতে — বাকী থেকে আংশিক কিস্তিতে চলে যায়', () => {
    assert.strictEqual(String(w.__state.rows[0][5]), '400', `Actual = ${w.__state.rows[0][5]}`);
    assert.deepStrictEqual(names('#tbl-partial'), ['Zara Member'], 'আংশিক কিস্তিতে নেই');
    assert.deepStrictEqual(names('#tbl-due'), ['Alpha Member'], 'বাকী কিস্তিতে ভুল তালিকা');
  });

  await check('বাকী টাকা পুরো দিলে আদায় কিস্তিতে চলে যায়', async () => {
    $('#today-member-code').value = '0456';
    w.__fillTodayMember();
    await w.__addTodayRow();
    assert.deepStrictEqual(names('#tbl-paid'), ['Alpha Member'], 'আদায় কিস্তিতে যায়নি');
    assert.deepStrictEqual(names('#tbl-due'), [], 'বাকী কিস্তিতে এখনো আছে');
    assert.strictEqual($('#count-today-paid') || null, null);
  });

  await check('কিস্তি তালিকায় না থাকা সদস্য → অন্যান্য টেবিলে যায়', async () => {
    $('#today-member-code').value = '0999';
    w.__fillTodayMember();
    $('#today-loan').value = '0';
    $('#today-savings').value = '200';
    await w.__addTodayRow();
    assert.deepStrictEqual(todayNames('#today-other-list'), ['Other Woman'], 'অন্যান্য টেবিলে নেই');
    assert.strictEqual(bn2en($('#count-today-other').textContent.trim()), '1', 'other count wrong');
  });

  await check('Today তালিকায় A→Z (ছোট থেকে বড়)', () => {
    const codes = $$('#today-monthly-list tr.today-row').map((tr) => tr.querySelectorAll('td')[1].textContent.trim());
    assert.deepStrictEqual(codes, ['0123', '0456'], codes.join(','));
  });

  await check('Neon-এ দুই টেবিলের এন্ট্রি সেভ হয়', () => {
    assert(saved && saved.dailyData.todayRows.length === 3, 'তিনটি এন্ট্রি সেভ হয়নি');
  });

  await check('রিসেট শুধু এন্ট্রি ঘর ফাঁকা করে — তালিকা/কিস্তি অপরিবর্তিত', async () => {
    $('#today-member-code').value = '0456';
    $('#today-loan').value = '777';
    const before = w.__state.todayRows.length;
    $('#btn-reset-today').click();
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual($('#today-member-code').value, '', 'কোড ঘর ফাঁকা হয়নি');
    assert.strictEqual($('#today-loan').value, '', 'লোন ঘর ফাঁকা হয়নি');
    assert.strictEqual(w.__state.todayRows.length, before, 'তালিকা বদলে গেছে');
    assert.strictEqual(String(w.__state.rows[0][5]), '400', `Zara Actual বদলে গেছে: ${w.__state.rows[0][5]}`);
    assert.strictEqual(String(w.__state.rows[1][5]), '1000', `Alpha Actual বদলে গেছে: ${w.__state.rows[1][5]}`);
    assert.deepStrictEqual(names('#tbl-paid'), ['Alpha Member'], 'আদায় কিস্তি থেকে সরে গেছে');
    assert.deepStrictEqual(names('#tbl-partial'), ['Zara Member'], 'আংশিক থেকে সরে গেছে');
  });

  await check('হিসাব ক্লোজ করলে দুই টেবিলই ফাঁকা হয়', async () => {
    await w.__closeTodayAccount();
    assert.strictEqual($$('#today-monthly-list tr.today-row').length, 0, 'মাসিক টেবিল খালি হয়নি');
    assert.strictEqual($$('#today-other-list tr.today-row').length, 0, 'অন্যান্য টেবিল খালি হয়নি');
    assert.strictEqual(w.__state.todayRows.length, 0, 'এন্ট্রি মুছেনি');
    assert.strictEqual(String(w.__state.rows[1][5]), '1000', 'ক্লোজে কিস্তির অঙ্ক বদলে গেছে');
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  process.exit(failed ? 1 : 0);
}, 400);
