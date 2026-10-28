/* যাচাই: হিসাবের খাতার এন্ট্রি এডিট ও ডিলিট — কিস্তির আদায়ও মিলে থাকে */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const memberDBHeaders = ['Member No', 'Member Name', 'Center Code'];
const memberDB = [['001401418', 'Test Member A', '0006']];
const headers = ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'];
const rows = [['001401418', 'Test Member A', '0006', '1200', '0']];
const cloud = {
  headers, rows, collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders, memberDB, balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.confirm = () => true;
w.fetch = async (url, opt) => {
  if (opt && (opt.method === 'PUT' || opt.method === 'POST')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: new Date().toISOString() }) };
  }
  if (String(url).includes('meta=1')) return { ok: true, status: 200, json: async () => ({ updated_at: null, counts: {} }) };
  return { ok: true, status: 200, json: async () => cloud };
};
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__fill = fillTodayMember;
window.__close = closeTodayAccount;
window.__undo = undoTodayAccountClose;
window.__deleteToday = deleteTodayRow;
window.__renderHistory = renderHistory;
window.__actual = () => state.rows[0][state.detect.actual];
`);

const $ = (s) => w.document.querySelector(s);
const results = [];
const check = (name, fn) => {
  try { fn(); results.push('✅ ' + name); }
  catch (e) { results.push('❌ ' + name + ' → ' + e.message); process.exitCode = 1; }
};
const setVal = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

setTimeout(async () => {
  // এন্ট্রি → ক্লোজ → খাতায় ১টি সারি
  setVal('#today-member-code', '1418');
  w.__fill();
  setVal('#today-loan', '500');
  await w.__add();
  await w.__close();
  w.__renderHistory();

  check('খাতায় এন্ট্রি জমা হয়েছে', () => {
    assert.strictEqual(w.__state.history.length, 1, 'খাতায় নেই');
    assert.strictEqual(Number(w.__actual()), 500, 'কিস্তিতে আদায় বসেনি: ' + w.__actual());
  });

  // ---- এডিট ----
  const editBtn = $('#history-list [data-edit-history]');
  check('খাতার সারিতে ✏️ বাটন কাজ করে', () => {
    assert(editBtn, 'এডিট বাটন নেই');
    editBtn.click();
    assert.strictEqual($('#btn-add-today').textContent.includes('খাতার এন্ট্রি আপডেট'), true, 'বাটন মোড বদলায়নি: ' + $('#btn-add-today').textContent);
    assert.strictEqual($('#today-loan').value, '500', 'ফর্মে আগের অঙ্ক বসেনি');
  });

  setVal('#today-loan', '800');
  await w.__add();
  w.__renderHistory();

  check('এডিট করলে খাতার সারি আপডেট হয় (নতুন সারি যোগ হয় না)', () => {
    assert.strictEqual(w.__state.history.length, 1, `সারি ${w.__state.history.length}টি — ডুপ্লিকেট হয়েছে`);
    assert.strictEqual(Number(w.__state.history[0].loan), 800, 'খাতায় নতুন অঙ্ক বসেনি');
  });
  check('এডিটে কিস্তির আদায়ও নতুন অঙ্কে মেলে', () => {
    assert.strictEqual(Number(w.__actual()), 800, 'কিস্তি = ' + w.__actual());
  });
  check('আপডেটের পরে বাটন আবার যোগ মোডে', () => {
    assert.strictEqual($('#btn-add-today').textContent.includes('তালিকায় যোগ'), true, $('#btn-add-today').textContent);
  });

  // ---- ডিলিট ----
  const delBtn = $('#history-list [data-del-history]');
  check('খাতার সারিতে 🗑️ বাটন কাজ করে', () => {
    assert(delBtn, 'ডিলিট বাটন নেই');
  });
  await new Promise((r) => setTimeout(r, 50));
  $('#history-list [data-del-history]').click();
  await new Promise((r) => setTimeout(r, 300));
  w.__renderHistory();

  check('ডিলিট করলে খাতার সারি যায়', () => {
    assert.strictEqual(w.__state.history.length, 0, 'সারি এখনো আছে');
  });
  check('ডিলিটে কিস্তির আদায়ও ফিরে যায়', () => {
    assert.strictEqual(Number(w.__actual()), 0, 'কিস্তি = ' + w.__actual());
  });

  // ---- History edit → Undo → Today delete: appliedLoan baseline অবশ্যই edited loan ----
  setVal('#today-member-code', '1418');
  w.__fill();
  setVal('#today-loan', '700');
  await w.__add();
  await w.__close();
  w.__renderHistory();
  $('#history-list [data-edit-history]').click();
  setVal('#today-loan', '900');
  await w.__add();
  await w.__undo();

  check('History edit-এর পর Undo করলে Today-এর appliedLoan edited অঙ্কই থাকে', () => {
    assert.strictEqual(w.__state.todayRows.length, 1);
    assert.strictEqual(w.__state.history.length, 0);
    assert.strictEqual(Number(w.__state.todayRows[0].loan), 900);
    assert.strictEqual(Number(w.__state.todayRows[0].appliedLoan), 900, 'পুরোনো appliedLoan ফিরে এসেছে');
    assert.strictEqual(Number(w.__actual()), 900, 'Undo-এ Actual বদলেছে');
  });

  await w.__deleteToday(0);
  check('Undo করা edited entry মুছলে সম্পূর্ণ আদায়ই ফিরে যায়', () => {
    assert.strictEqual(w.__state.todayRows.length, 0);
    assert.strictEqual(Number(w.__actual()), 0, 'Actual = ' + w.__actual());
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 400);
