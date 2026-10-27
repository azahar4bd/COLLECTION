/* v9.2: Today পেজের আদায় স্থায়ী — রিসেটে বাকীতে ফেরে না; "হিসাব ক্লোজ" তারিখভিত্তিক খাতায় জমা রাখে। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const memberDBHeaders = ['Member Code', 'Member Name', 'Center Code'];
const memberDB = [
  ['0000123', 'Zara Member', '101'],
  ['0000456', 'Alpha Member', '102'],
  ['0000999', 'Other Woman', '103'],
];
const headers = ['Member Code', 'Member Name', 'Center Code', 'Staff Name', 'Installment Amount', 'Installment Actual'];
const rows = [
  ['0000123', 'Zara Member', '101', 'Collector A', '1000', '0'],
  ['0000456', 'Alpha Member', '102', 'Collector A', '1000', '0'],
];

let saved = null;
const cloud = { headers, rows, collections: [], followups: [], history: [], dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] } };

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
  const todayUpserts = patch.todayUpserts || [], historyUpserts = patch.historyUpserts || [];
  const todayRemove = new Set((patch.todayRemoveIds || []).map(String));
  const historyRemove = new Set((patch.historyRemoveIds || []).map(String));
  const todayUpsertIds = new Set(todayUpserts.map((item) => String(item.id)));
  const historyUpsertIds = new Set(historyUpserts.map((item) => String(item.id)));
  if (todayUpserts.length || todayRemove.size || historyUpsertIds.size) {
    const current = Array.isArray(next.dailyData.todayRows) ? next.dailyData.todayRows : [];
    next.dailyData.todayRows = [...todayUpserts, ...current.filter((item) => !todayRemove.has(String(item.id)) && !todayUpsertIds.has(String(item.id)) && !historyUpsertIds.has(String(item.id)))];
  }
  if (historyUpserts.length || historyRemove.size || todayUpsertIds.size) {
    const current = Array.isArray(next.history) ? next.history : [];
    next.history = [...historyUpserts, ...current.filter((item) => !historyRemove.has(String(item.id)) && !historyUpsertIds.has(String(item.id)) && !todayUpsertIds.has(String(item.id)))];
  }
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
window.__fillTodayMember = fillTodayMember;
window.__closeTodayAccount = closeTodayAccount;
window.__renderHistory = renderHistory;
window.__flush = flushOutbox;
`);

const $ = (s) => w.document.querySelector(s);
const $$ = (s) => [...w.document.querySelectorAll(s)];
const names = (sel) => $$(sel + ' tr').map((tr) => tr.querySelectorAll('td')[1]?.textContent.trim()).filter(Boolean);
const todayNames = (sel) => $$(sel + ' tr.today-row').map((tr) => tr.querySelectorAll('td')[3]?.textContent.trim()).filter(Boolean);

async function addEntry(code, amounts) {
  $('#today-member-code').value = code;
  w.__fillTodayMember();
  $('#today-loan').value = String(amounts.loan || 0);
  $('#today-savings').value = String(amounts.savings || 0);
  $('#today-dps').value = String(amounts.dps || 0);
  await w.__addTodayRow();
  await w.__flush();
}

setTimeout(async () => {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`✅ ${name}`); }
    catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
  };

  await check('মাসিক আদায় → আংশিক কিস্তিতে যায়', async () => {
    await addEntry('0123', { loan: 400 });
    assert.deepStrictEqual(names('#tbl-partial'), ['Zara Member'], 'আংশিক কিস্তিতে নেই');
  });

  await check('অন্যান্য আদায় (কিস্তি তালিকায় নেই) → অন্যান্য টেবিলে', async () => {
    await addEntry('0999', { savings: 200 });
    assert.deepStrictEqual(todayNames('#today-other-list'), ['Other Woman'], 'অন্যান্য টেবিলে নেই');
  });

  await check('রিসেট শুধু এন্ট্রি ঘর ফাঁকা করে — তালিকা ও কিস্তি অপরিবর্তিত', async () => {
    $('#today-member-code').value = '0456';
    $('#today-loan').value = '500';
    const beforeRows = w.__state.todayRows.length;
    $('#btn-reset-today').click();
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual($('#today-member-code').value, '', 'কোড ঘর ফাঁকা হয়নি');
    assert.strictEqual($('#today-loan').value, '', 'লোন ঘর ফাঁকা হয়নি');
    assert.strictEqual($('#today-savings').value, '', 'সঞ্চয় ঘর ফাঁকা হয়নি');
    assert.strictEqual($('#today-total').value, '', 'মোট ঘর ফাঁকা হয়নি');
    assert.strictEqual(w.__state.todayRows.length, beforeRows, 'তালিকা বদলে গেছে (ফাঁকা হয়ে গেছে)');
    assert.strictEqual(String(w.__state.rows[0][5]), '400', `Actual বদলে গেছে: ${w.__state.rows[0][5]}`);
    assert.deepStrictEqual(names('#tbl-partial'), ['Zara Member'], 'আংশিক থেকে সরে গেছে');
  });

  await check('আংশিক সদস্য বাকী টাকা দিলে পুরো হলে আদায় কিস্তিতে যায়', async () => {
    await addEntry('0123', { loan: 600 });   // ৪০০ + ৬০০ = ১০০০ = পুরো কিস্তি
    assert.deepStrictEqual(names('#tbl-paid'), ['Zara Member'], 'আদায় কিস্তিতে যায়নি');
    assert.deepStrictEqual(names('#tbl-partial'), [], 'আংশিকে এখনো আছে');
  });

  await check('আরেকটি আদায় নিয়ে হিসাব ক্লোজ করলে খাতায় জমা হয়', async () => {
    await addEntry('0999', { savings: 300 }); // একই member-এর ভিন্ন অঙ্ক—intentional duplicate নয়
    assert.strictEqual(w.__state.todayRows.length, 4, `এন্ট্রি ${w.__state.todayRows.length}`);
    await w.__closeTodayAccount();
    await w.__flush();
    assert.strictEqual(w.__state.todayRows.length, 0, 'ক্লোজের পর তালিকা খালি হয়নি');
    assert.strictEqual(w.__state.history.length, 4, `খাতায় এন্ট্রি ${w.__state.history.length}`);
    assert.strictEqual(w.__state.history.filter((h) => h.kind === 'monthly').length, 2, 'মাসিক গণনা ভুল');
    assert.strictEqual(w.__state.history.filter((h) => h.kind === 'other').length, 2, 'অন্যান্য গণনা ভুল');
    assert.strictEqual(String(w.__state.rows[0][5]), '1000', 'ক্লোজে কিস্তির অঙ্ক বদলে গেছে');
    assert(saved && saved.history.length === 4, 'Neon-এ history সেভ হয়নি');
  });

  await check('খাতার টেবিলে এন্ট্রি ও ধরন দেখায়', () => {
    w.__renderHistory();
    const cells = $$('#history-list tr').map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    assert.strictEqual(cells.length, 4, `সারি ${cells.length}`);
    const kinds = cells.map((c) => c[1]);
    assert.strictEqual(kinds.filter((k) => k === '📅 মাসিক').length, 2, `মাসিক সারি = ${kinds.join(',')}`);
    assert.strictEqual(kinds.filter((k) => k === '🗂️ অন্যান্য').length, 2, `অন্যান্য সারি = ${kinds.join(',')}`);
    /* সামারি কার্ড বাদ — এখন প্রতিটি সারির মোট যোগ করে দেখি */
    const totalSum = cells.reduce((sum, c) => sum + Number(String(c[8]).replace(/[^\d০-৯]/g, '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)) || 0), 0);
    assert.strictEqual(totalSum, 1500, `মোট = ${totalSum}`);
  });

  await check('খাতার প্রতিটি সারিতে এডিট ও ডিলিট বাটন আছে', () => {
    w.__renderHistory();
    const rows = $$('#history-list tr');
    assert(rows.length > 0, 'সারি নেই');
    rows.forEach((tr, i) => {
      assert(tr.querySelector('[data-edit-history]'), `সারি ${i + 1}-এ এডিট নেই`);
      assert(tr.querySelector('[data-del-history]'), `সারি ${i + 1}-এ ডিলিট নেই`);
    });
    const heads = [...$('#history-table').querySelectorAll('thead th')].map((th) => th.textContent.trim());
    assert(heads.includes('কাজ'), `কাজ কলাম নেই — ${heads.join(',')}`);
  });

  await check('সামারি কার্ডগুলো আর নেই (এন্ট্রি/মাসিক/অন্যান্য/মোট)', () => {
    assert.strictEqual($('#history-summary'), null, 'সামারি কার্ড এখনো আছে');
    const html = $('#history-card').textContent;
    assert(!/মোট আদায়/.test(html), 'মোট আদায় কার্ড এখনো দেখা যাচ্ছে');
  });

  await check('তারিখ ফিল্টার — অন্য তারিখ দিলে কিছু থাকে না', () => {
    $('#history-date').value = '2020-01-01';
    w.__renderHistory();
    assert.strictEqual($$('#history-list tr').length, 0, 'ভুল তারিখেও সারি আছে');
    assert.ok(!$('#history-empty').classList.contains('hidden'), 'ফাঁকা বার্তা নেই');
    $('#history-date').value = '';
    w.__renderHistory();
    assert.strictEqual($$('#history-list tr').length, 4, 'সব তারিখে ফিরে আসেনি');
  });

  await check('খাতার হিসাব রিলোডেও থাকে (Neon থেকে ফেরা)', () => {
    assert(saved && Array.isArray(saved.history) && saved.history.length === 4, 'payload-এ history নেই');
    assert.strictEqual(saved.history[0].memberName, 'Other Woman');
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  process.exit(failed ? 1 : 0);
}, 400);
