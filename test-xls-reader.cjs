/* যাচাই: নিজস্ব .xls (BIFF8/OLE2) পাঠক
   — gBanker "All Members Profile" রিপোর্ট লেগ্য .xls ফরম্যাটে আসে;
     এখানে সেই ফাইলের সাথে মিলিয়ে ঠিকমতো পড়া যায় কি না দেখা হয়। */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = __dirname;
require(path.join(ROOT, 'shared/xls-reader.js'));

const reader = globalThis.COLLECTION_XLS;
const fixture = path.join(ROOT, 'test-fixtures', 'members-sample.xls');
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`✅ ${name}`); }
  catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
};

check('পাঠক লোড হয়েছে', () => assert.ok(reader && typeof reader.readWorkbook === 'function'));

const wb = reader.readWorkbook(fs.readFileSync(fixture));
const rows = wb.sheets[0].rows;

check('একটি শিট পড়া হয়েছে', () => assert.strictEqual(wb.sheets.length, 1));
check('শিটের নাম আছে', () => assert.ok(wb.sheets[0].name && wb.sheets[0].name.length > 0));
check('প্রিলগ লাইন আছে (BKF / GOBRA)', () => {
  assert.ok(String(rows[0][0]).includes('Bandhu Kallyan Foundation'));
  assert.ok(String(rows[1][0]).includes('GOBRA BRANCH'));
});
check('হেডার সারি চেনা গেছে', () => assert.ok(String(rows[5][3]).includes('Member')));
check('৪০০ সারির ডেটা পড়া হয়েছে', () => assert.strictEqual(rows.length, 406));
check('প্রথম সারির মেম্বার কোড ঠিক', () => assert.strictEqual(String(rows[6][3]), '0014100001'));
check('শেষ সারির মেম্বার কোড ঠিক', () => assert.strictEqual(String(rows[405][3]), '0014100400'));
check('সদস্যের নাম ঠিক', () => assert.strictEqual(String(rows[6][5]), 'Name1'));
check('পিতা/স্বামীর নাম ঠিক', () => assert.strictEqual(String(rows[6][8]), 'Guardian 1'));
check('ফোন নম্বর ঠিক', () => assert.strictEqual(String(rows[6][7]), '01910000001'));
check('স্ট্যাটাস ঠিক', () => assert.ok(['Active', 'Drop'].includes(String(rows[6][16]).trim())));
check('বাংলা লেখা অক্ষত আছে', () => assert.ok(String(rows[405][17]).includes('ঢাকা')));
check('SST CONTINUE রেকর্ড পড়া হয়েছে (SST ৮২০৩ বাইট + ৮টি CONTINUE)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'shared/xls-reader.js'), 'utf8');
  assert.ok(src.includes('parseSst'), 'SST পার্সার নেই');
  // সব স্ট্রিং ঠিকমতো এসেছে কি না — অন্তত ৪০০টি ইউনিক মেম্বার কোড
  const codes = new Set(rows.slice(6).map((r) => String(r[3]).trim()).filter(Boolean));
  assert.strictEqual(codes.size, 400);
});
check('সংখ্যা সেল (Age) সঠিক', () => assert.strictEqual(String(rows[6][9]), '21'));

console.log('\n' + results.join('\n'));
const failed = results.filter((r) => r.startsWith('❌')).length;
console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
process.exit(failed ? 1 : 0);
