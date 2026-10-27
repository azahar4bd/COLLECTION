/* Today entry inputs: visible caret/focus rules and every field remains focusable. */
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const css = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const results = [];
const check = (name, fn) => {
  try { fn(); results.push('✅ ' + name); }
  catch (error) { results.push('❌ ' + name + ' → ' + error.message); process.exitCode = 1; }
};

check('Today input-এ অক্টিভ লাল caret color স্পষ্টভাবে নির্ধারিত', () => {
  assert(/\.today-entry-grid input\s*\{[^}]*caret-color:\s*#dc2626\s*!important/s.test(css));
  assert(!css.includes('caret-color: transparent'));
});

check('Click/focus-এ 3px solid outline ও focus ring; outline:none নয়', () => {
  const rule = css.match(/\.today-entry-grid input:focus,\s*\.today-entry-grid input\.input-focus-active\s*\{([^}]+)\}/s);
  assert(rule, 'focus rule missing');
  assert(rule[1].includes('outline: 3px solid #1d4ed8 !important'));
  assert(rule[1].includes('outline-offset: 1px'));
  assert(rule[1].includes('box-shadow:'));
  assert(!rule[1].includes('outline: none'));
});

check('Focus event-এর বাড়তি JS class ও field ✏️ indicator আছে', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  assert(app.includes("addEventListener('focusin'"));
  assert(app.includes('input-focus-active'));
  assert(app.includes('field-focus-active'));
  assert(css.includes('field-focus-active > label::after'));
});

check('সব Today entry field click/focus পেলে active element হয়', () => {
  const dom = new JSDOM(html, { url: 'https://focus.test/', pretendToBeVisual: true });
  const { document } = dom.window;
  document.querySelector('#app').classList.remove('hidden');
  document.querySelector('#today-page').classList.remove('hidden');
  const ids = ['today-member-code', 'today-center-code', 'today-member-name', 'today-loan', 'today-savings', 'today-dps', 'today-total'];
  for (const id of ids) {
    const input = document.getElementById(id);
    assert(input, id + ' missing');
    input.focus();
    assert.strictEqual(document.activeElement, input, id + ' focus পায়নি');
  }
  dom.window.close();
});

console.log(results.join('\n'));
const failed = results.filter((line) => line.startsWith('❌')).length;
console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
process.exit(failed ? 1 : 0);
