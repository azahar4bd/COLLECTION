/* যাচাই: Today All Collection — এন্ট্রি এডিট ও ডিলিট (v9.11) */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const headers = ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual', 'Installment Date'];
const rows = [['001401418', 'Test Member A', '0006', '1200', '0', '2026-10-21']];
const cloud = {
  headers, rows, collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders: ['Member No', 'Member Name'], memberDB: [['001401418', 'Test Member A']], balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + `
;window.__state = state;
window.__add = addTodayRow;
window.__del = deleteTodayRow;
window.__edit = startEditToday;
window.__actual = () => state.rows[0][state.detect.actual];
`);
const $ = (sel) => w.document.querySelector(sel);

setTimeout(async () => {
  const results = [];
  const check = (name, fn) => { try { fn(); results.push('✅ ' + name); } catch (e) { results.push('❌ ' + name + ' → ' + e.message); process.exitCode = 1; } };
  const setVal = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const fill = (loan, savings = 0, dps = 0) => { setVal('#today-member-code', '1418'); setVal('#today-member-name', 'Test Member A'); setVal('#today-loan', loan); setVal('#today-savings', savings); setVal('#today-dps', dps); };

  // ১) নতুন এন্ট্রি + কিস্তিতে আদায় বসা
  fill(1200);
  await w.__add();
  check('new entry added and applied to installment', () => {
    assert.strictEqual(w.__state.todayRows.length, 1, 'entry missing');
    assert.strictEqual(Number(w.__actual()), 1200, 'installment actual not updated: ' + w.__actual());
  });

  check('each row has edit and delete buttons', () => {
    const edit = $('#today-monthly-list [data-edit-today]') || $('#today-other-list [data-edit-today]');
    const del = $('#today-monthly-list [data-del-today]') || $('#today-other-list [data-del-today]');
    assert(edit, 'edit button missing');
    assert(del, 'delete button missing');
  });

  // ২) এডিট
  w.__edit(0);
  check('edit loads the entry into the form', () => {
    assert.strictEqual($('#today-loan').value, '1200', 'loan not loaded: ' + $('#today-loan').value);
    assert.strictEqual($('#btn-add-today').textContent.includes('আপডেট'), true, 'button not in update mode');
  });

  fill(600);
  await w.__add();
  check('update replaces the entry (no duplicate)', () => {
    assert.strictEqual(w.__state.todayRows.length, 1, 'duplicated: ' + w.__state.todayRows.length);
    assert.strictEqual(Number(w.__state.todayRows[0].loan), 600, 'loan not updated');
    assert.strictEqual(Number(w.__actual()), 600, 'installment actual not re-synced: ' + w.__actual());
  });
  check('button returns to Add mode after update', () => {
    assert.strictEqual($('#btn-add-today').textContent.includes('তালিকায় যোগ'), true, 'button text: ' + $('#btn-add-today').textContent);
  });

  // ৩) ডিলিট
  await w.__del(0);
  check('delete removes the entry', () => {
    assert.strictEqual(w.__state.todayRows.length, 0, 'entry still there');
  });
  check('delete reverses the amount in the installment list', () => {
    assert.strictEqual(Number(w.__actual()), 0, 'installment actual not reverted: ' + w.__actual());
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 400);
