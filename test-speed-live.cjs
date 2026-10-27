/* v9.12 যাচাই: এন্ট্রি সেভে ছোট প্যাচ যায়, খসড়া ফিরে আসে, কল থেকে ফেরলে রিলোড হয় না। */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'];
const rows = [['001401418', 'Test Member A', '0006', '1200', '0']];
const memberDBHeaders = ['Member No', 'Member Name', 'Center Code & Name'];
// মেম্বার ডাটাবেজ মোটা রাখি — পুরো ডকুমেন্ট কত বড় তা বোঝাতে
const memberDB = Array.from({ length: 4000 }, (_, i) => [String(1400000 + i), 'Member ' + i, '0006, GOBRA BAZ']);
const cloud = {
  headers, rows, collections: [], followups: [], history: [],
  updated_at: '2026-10-21T10:00:00.000Z',
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const writes = [];   // { method, bytes, body }
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.confirm = () => true;
w.fetch = async (url, options) => {
  const method = options?.method || 'GET';
  if (method === 'PUT' || method === 'POST') {
    writes.push({ method, bytes: Buffer.byteLength(options.body, 'utf8'), body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) };
  }
  return { ok: true, status: 200, json: async () => cloud };
};
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__saveDraft = saveTodayDraft;
window.__restoreDraft = restoreTodayDraft;
window.__resume = resumeFromBackground;
window.__showPage = showPage;
window.__persist = persistRows;
`);

const $ = (sel) => w.document.querySelector(sel);
const results = [];
const check = (name, fn) => {
  try { fn(); results.push('✅ ' + name); }
  catch (e) { results.push('❌ ' + name + ' → ' + e.message); process.exitCode = 1; }
};

setTimeout(async () => {
  const setVal = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

  check('অ্যাপ চালু হয়েই লোকাল ক্যাশ লেখা হয় (পরের বার সাথে সাথে খুলবে)', () => {
    assert(w.localStorage.getItem('collectionManager.fullDoc.v1'), 'লোকাল ক্যাশ নেই');
  });

  // ---- ১) এন্ট্রি সেভ: ছোট প্যাচ ----
  setVal('#today-member-code', '1418');
  setVal('#today-member-name', 'Test Member A');
  setVal('#today-loan', '1200');
  await w.__add();
  await new Promise((r) => setTimeout(r, 150));

  const fullSize = Buffer.byteLength(JSON.stringify(cloud), 'utf8');
  const entryWrite = writes[writes.length - 1];
  check('এন্ট্রি সেভে পুরো ডকুমেন্ট নয়, ছোট প্যাচ যায়', () => {
    assert(entryWrite, 'কোনো লেখা হয়নি');
    assert.strictEqual(entryWrite.method, 'POST', `পদ্ধতি = ${entryWrite.method}`);
    assert(entryWrite.body.patch, 'প্যাচ নেই');
    assert(entryWrite.bytes < fullSize / 10, `প্যাচ ${entryWrite.bytes}B, পুরো ডকুমেন্ট ${fullSize}B — ১০ ভাগের ১ ভাগের কম হওয়া উচিত`);
  });
  check('প্যাচে শুধু বদলানো অংশ আছে', () => {
    const keys = Object.keys(entryWrite.body.patch);
    assert(keys.includes('todayUpserts'), `todayUpserts নেই — ${keys}`);
    assert(!keys.includes('todayRows'), 'পুরো Today array পাঠানো হয়েছে—multi-device merge ভাঙবে');
    assert(keys.includes('rowUpdates'), `কিস্তির বদলানো সারি নেই — ${keys}`);
    assert(!keys.includes('memberDB'), 'অপরিবর্তিত মেম্বার ডাটাবেজও পাঠানো হয়েছে');
    assert(entryWrite.body.patch.rowUpdates.length === 1, `সারি ${entryWrite.body.patch.rowUpdates.length}টি — একটাই বদলেছে`);
  });

  // ---- ২) প্রতিশ্রুতি সেভ ----
  writes.length = 0;
  w.eval("window.__state.followups = [{ key:'code:1418', memberCode:'1418', memberName:'Test Member A', promise:'শুক্রবার', nextDate:'2026-10-24', updatedAt:new Date().toISOString() }]");
  await w.__persist();
  await new Promise((r) => setTimeout(r, 200));
  check('প্রতিশ্রুতি সেভেও ছোট প্যাচ', () => {
    const wr = writes[writes.length - 1];
    assert(wr && wr.body.patch, 'প্যাচ যায়নি');
    assert(wr.body.patch.followups, 'followups প্যাচে নেই');
    assert(wr.bytes < 3000, `প্যাচ ${wr.bytes}B — বড় হয়ে গেছে`);
  });

  // ---- ৩) খসড়া: টাইপ করা অবস্থায় ফিরে আসা ----
  setVal('#today-member-code', '5965');
  setVal('#today-member-name', 'ROJIYA SULTANA');
  setVal('#today-loan', '500');
  setVal('#today-savings', '100');
  await new Promise((r) => setTimeout(r, 350));
  // ধরো অ্যাপ বন্ধ হয়ে গেল — ফর্ম খালি করে আবার খুললাম
  ['#today-member-code', '#today-member-name', '#today-loan', '#today-savings'].forEach((s) => { $(s).value = ''; });
  const restored = w.__restoreDraft();
  check('কল থেকে ফিরলে অর্ধেক-টাইপ করা এন্ট্রি হারায় না', () => {
    assert(restored, 'খসড়া ফেরেনি');
    assert.strictEqual($('#today-member-code').value, '5965', 'কোড ফেরেনি');
    assert.strictEqual($('#today-member-name').value, 'ROJIYA SULTANA', 'নাম ফেরেনি');
    assert.strictEqual($('#today-loan').value, '500', 'লোন ফেরেনি');
    assert.strictEqual($('#today-savings').value, '100', 'সঞ্চয় ফেরেনি');
  });

  // ---- ৪) কোন পেজে ছিলেন সেটা মনে থাকে ----
  w.__showPage('today');
  const ui = JSON.parse(w.localStorage.getItem('collectionManager.uiState.v1') || 'null');
  check('কোন পেজে ছিলেন তা সংরক্ষিত', () => {
    assert(ui && ui.page === 'today', `UI অবস্থা = ${JSON.stringify(ui)}`);
  });

  // ---- ৫) ব্যাকগ্রাউন্ড থেকে ফেরা: রিলোড নয় ----
  const before = w.__state.rows.length;
  let metaCalls = 0;
  const baseFetch = w.fetch;
  w.fetch = async (url, options) => { if (String(url).includes('meta=1')) metaCalls += 1; return baseFetch(url, options); };
  await w.__resume();
  await new Promise((r) => setTimeout(r, 200));
  check('কল থেকে ফিরলে পুরো ডাটা আবার নামায় না', () => {
    assert(metaCalls >= 1, 'মেটা চেক হয়নি');
    assert.strictEqual(w.__state.rows.length, before, 'ডাটা বদলে গেছে');
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 500);
