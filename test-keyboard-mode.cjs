/* যাচাই: ফোনে কীবোর্ড খুললে কার্ড+ফর্ম একসাথে দেখানোর মোড চালু হয় */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const cloud = {
  headers: ['Member Code', 'Member Name', 'Center Code', 'Installment Amount', 'Installment Actual'],
  rows: [['001401418', 'Test Member A', '0006', '1200', '0']],
  collections: [], followups: [], history: [],
  dailyData: { memberDBHeaders: ['Member No', 'Member Name'], memberDB: [['001401418', 'Test Member A']], balanceHeaders: [], balanceRows: [], todayRows: [] },
};

const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true }).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
w.innerHeight = 800;
// কীবোর্ড বন্ধ অবস্থায়
w.visualViewport = { height: 800, addEventListener() {}, removeEventListener() {} };
w.fetch = async () => ({ ok: true, status: 200, json: async () => cloud });
w.eval(fs.readFileSync('app.js', 'utf8') + ';window.__syncKb = syncKeyboardMode;');

const $ = (s) => w.document.querySelector(s);
const results = [];
const check = (name, fn) => {
  try { fn(); results.push('✅ ' + name); }
  catch (e) { results.push('❌ ' + name + ' → ' + e.message); process.exitCode = 1; }
};

setTimeout(() => {
  check('শুরুতে কম্প্যাক্ট মোড বন্ধ', () => {
    assert(!w.document.body.classList.contains('kb-open'), 'শুরু থেকেই kb-open');
  });

  check('এন্ট্রি ঘরে ফোকাস করলে কম্প্যাক্ট মোড চালু', () => {
    $('#today-member-code').focus();
    assert(w.document.body.classList.contains('kb-open'), 'kb-open আসেনি');
    assert(w.document.body.classList.contains('kb-entry'), 'kb-entry আসেনি');
  });

  check('কীবোর্ড বন্ধ হলে (ভিউপোর্ট ছোট) — মোড চালু থাকে', () => {
    w.visualViewport.height = 800 - 300;   // ৩০০px কীবোর্ড
    w.__syncKb();
    assert(w.document.body.classList.contains('kb-open'), 'kb-open নেই');
    assert.strictEqual(w.document.documentElement.style.getPropertyValue('--keyboard-h').trim(), '300px');
  });

  check('ফোকাস সরালে স্বাভাবিক মোডে ফেরে', async () => {
    $('#today-member-code').blur();
    w.visualViewport.height = 800;
    w.__syncKb();
    assert(!w.document.body.classList.contains('kb-open'), 'kb-open এখনো আছে');
  });

  check('CSS-এ কম্প্যাক্ট নিয়মগুলো আছে', () => {
    const css = fs.readFileSync('styles.css', 'utf8');
    ['body.kb-open .app-header', 'body.kb-open .bottom-nav', 'body.kb-open #today-page .today-entry-grid',
     'body.kb-open .balance-chip', 'body.kb-open #today-balance-summary', '--keyboard-h'].forEach((needle) => {
      assert(css.includes(needle), `CSS-এ নেই: ${needle}`);
    });
  });

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  w.close();
  process.exit(failed ? 1 : 0);
}, 600);
