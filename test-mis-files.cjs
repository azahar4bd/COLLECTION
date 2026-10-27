/* যাচাই: কিস্তির তালিকা + পূর্বের স্থিতি—দুটি MIS ফাইল আপলোড।
   পুরোনো member report চেনা গেলেও upload গ্রহণ করে না; existing directory
   balance + current installment দিয়ে active-only compact হয়। */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = __dirname;
const FIX = path.join(ROOT, 'test-fixtures');

const w = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'https://demo.invalid', runScripts: 'outside-only', pretendToBeVisual: true,
}).window;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.confirm = () => true;
w.scrollTo = () => {};
w.fetch = (url, opts) => {
  if (opts && opts.method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  return new Promise(() => {});
};
w.eval(fs.readFileSync(path.join(ROOT, 'shared/csv-rules.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'shared/xls-reader.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'shared/active-members.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + `
;window.__state = state;
window.__handleMisFile = handleMisFile;
window.__applyMisFiles = applyMisFiles;
window.__misSlots = misSlots;
window.__parseReportFile = parseReportFile;
`);

const state = w.__state;
const $ = (sel) => w.document.querySelector(sel);
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`✅ ${name}`); }
  catch (e) { results.push(`❌ ${name} → ${e.message}`); process.exitCode = 1; }
};

const makeFile = (bytes, name, type) => new w.File([bytes], name, { type: type || 'application/octet-stream' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* ---------- ১) ফাইল শনাক্ত (ফরম্যাট অনুযায়ী) ---------- */
  const instFile = path.join(FIX, 'installment-sample.html');
  const memberFile = path.join(FIX, 'members-sample.xls');
  const passbookFile = path.join(FIX, 'balance-sample.csv');

  check('HTML এক্সপোর্ট ফাইল → কিস্তির তালিকা', async () => {});
  const instParsed = await w.__parseReportFile(makeFile(fs.readFileSync(instFile), 'installment.xls'));
  check('HTML ফাইলকে "কিস্তির তালিকা" চেনা হয়েছে', () => {
    assert.strictEqual(instParsed.format, 'html');
    assert.strictEqual(instParsed.type, 'installment');
    assert.ok(instParsed.rows.length > 1);
  });

  const memParsed = await w.__parseReportFile(makeFile(fs.readFileSync(memberFile), 'MemberlistReport.xls'));
  check('লেগ্য .xls ফাইল → সদস্য তালিকা', () => {
    assert.strictEqual(memParsed.format, 'xls');
    assert.strictEqual(memParsed.type, 'member');
  });

  let passbookParsed = null;
  if (fs.existsSync(passbookFile)) {
    passbookParsed = await w.__parseReportFile(makeFile(fs.readFileSync(passbookFile), 'Loan_SavingsBalance.csv'));
    check('পাসবুক CSV ফাইল → পূর্বের স্থিতি', () => {
      assert.strictEqual(passbookParsed.format, 'csv');
      assert.strictEqual(passbookParsed.type, 'balance');
    });
  } else {
    results.push('⚠️ পাসবুক CSV ফাইল নেই — ওই অংশটি বাদ');
  }

  /* ---------- ২) দুটি গ্রহণযোগ্য ফাইল + বন্ধ member upload ---------- */
  state.rows = []; state.headers = [];
  const legacyMembers = w.COLLECTION_CSV.parseMemberRows(memParsed.rows);
  state.memberDB = legacyMembers.rows; state.memberDBHeaders = legacyMembers.headers;
  state.balanceRows = []; state.balanceHeaders = [];

  await w.__handleMisFile(makeFile(fs.readFileSync(instFile), 'installment.xls'));
  await w.__handleMisFile(makeFile(fs.readFileSync(memberFile), 'MemberlistReport.xls'));
  const memberRejectMessage = $('#mis-upload-status').textContent;
  if (passbookParsed) await w.__handleMisFile(makeFile(fs.readFileSync(passbookFile), 'Loan_SavingsBalance.csv'));

  check('শুধু কিস্তি ও balance—দুটি ঘরে ফাইল বসেছে', () => {
    const slots = w.__misSlots;
    assert.ok(slots.installment, 'কিস্তির ফাইল বসেনি');
    assert.ok(!Object.prototype.hasOwnProperty.call(slots, 'member'), 'member slot এখনো আছে');
    if (passbookParsed) assert.ok(slots.balance, 'স্থিতির ফাইল বসেনি');
  });
  check('member upload rejected; দুটি গ্রহণযোগ্য ঘরের নাম দেখাচ্ছে', () => {
    assert.ok($('#mis-status-installment').textContent.includes('installment.xls'), $('#mis-status-installment').textContent);
    assert.ok(!$('#mis-status-member'), 'marked member status UI এখনো আছে');
    if (passbookParsed) assert.ok($('#mis-status-balance').textContent.includes('Loan_SavingsBalance.csv'));
    assert.ok(memberRejectMessage.includes('সদস্য তালিকা আর আপলোড'), memberRejectMessage);
  });
  check('আপলোড বাটন চালু হয়েছে', () => assert.strictEqual($('#btn-apply-mis-files').disabled, false));

  await w.__applyMisFiles();
  await wait(200);

  check('কিস্তির তালিকা ডেটাবেজ আপডেট হয়েছে', () => {
    assert.ok(state.rows.length > 1, 'কিস্তির সারি নেই');
    assert.ok(state.headers.includes('MemberCode'), 'হেডার নেই');
  });
  check('পুরোনো ৪০০-row directory active-only compact হয়েছে', () => {
    assert.ok(state.memberDB.length <= 400);
    assert.strictEqual(state.memberDBHeaders.length, 5);
    assert.ok(state.memberDB.every((row) => row.length === 5));
    assert.strictEqual(state.lastMemberPrune.before, 400);
    assert.strictEqual(state.lastMemberPrune.removed, 400 - state.memberDB.length);
  });
  if (passbookParsed) {
    check('পূর্বের স্থিতি ডেটাবেজ আপডেট হয়েছে (৯১৩ জন)', () => {
      assert.strictEqual(state.balanceRows.length, 913);
      assert.strictEqual(state.balanceHeaders[0], 'Member ID');
    });
    check('স্থিতির সংখ্যা ঠিক (পাসবুক রিপোর্টের সাথে মিলেছে)', () => {
      const row = state.balanceRows.find((r) => String(r[2]) === 'Test Member 1');
      assert.ok(row, 'Test Member 1 পাওয়া যায়নি');
      assert.strictEqual(Number(row[3]), 6);      // সঞ্চয়
      assert.strictEqual(Number(row[4]), 0);      // DPS
      assert.strictEqual(Number(row[5]), 7178);   // লোন
    });
    check('স্থিতির সেন্টার (সামিতি) ধরা পড়েছে', () => {
      assert.strictEqual(String(state.balanceRows[0][6]), '0003');
    });
  }
  check('স্ট্যাটাস মেসেজ দেখাচ্ছে', () => {
    const txt = $('#mis-upload-status').textContent;
    assert.ok(/আপলোড সম্পন্ন/.test(txt), txt);
  });

  console.log('\n' + results.join('\n'));
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n✅ পাস: ${results.length - failed}   ❌ ফেল: ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('TEST CRASH:', error);
  process.exit(1);
});
