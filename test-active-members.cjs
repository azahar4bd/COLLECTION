/* Active-only compact memberDB — pure rules + current 5,081-row fixture. */
const fs = require('fs');
require('./shared/active-members.js');
const { compactActiveMembers, COMPACT_HEADERS } = globalThis.COLLECTION_ACTIVE_MEMBERS;
let pass = 0, fail = 0;
function ok(value, label, extra) {
  if (value) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label, extra === undefined ? '' : JSON.stringify(extra)); }
}
const headers = ['Sl. No.', 'Center Code & Name', 'Member No', 'Member Name', 'Contact Number', 'Father / Husband / Care Of', 'Status', 'Unused'];
const members = [
  ['1', '0001, A', '001401234', 'Active Full', '01711000001', 'Guardian A', 'Drop', 'x'],
  ['2', '0002, B', '2222', 'Zero Only', '01711000002', 'Guardian B', 'Active', 'x'],
  ['3', '0003, C', '3333', 'Installment Only', '01711000003', 'Guardian C', 'Drop', 'x'],
  ['4', '0004, D', '4444', 'DPS Active', '01711000004', 'Guardian D', 'Active', 'x'],
];
const balanceHeaders = ['Member ID', '', 'Member Name', 'Savings Balance', 'DPS Balance', 'Loan Balance'];
const balanceRows = [
  ['1234', '', 'Active Full', '0', '0', '500', '0001'],
  ['2222', '', 'Zero Only', '0', '0', '0', '0002'],
  ['4444', '', 'DPS Active', '0', '25', '0', '0004'],
];
const installmentHeaders = ['CenterCode', 'MemberCode', 'MemberName', 'InstallmentAmount'];
const installmentRows = [['0003', '3333', 'Installment Only', '100']];
const input = { memberDBHeaders: headers, memberDB: members, balanceHeaders, balanceRows, installmentHeaders, installmentRows };
const before = JSON.stringify(input);
const result = compactActiveMembers(input);
ok(JSON.stringify(input) === before, 'input document mutate হয় না');
ok(result.stats.before === 4 && result.stats.after === 3 && result.stats.removed === 1, 'zero-only বাদ; balance + installment active থাকে', result.stats);
ok(result.rows.some(r => r[1] === '001401234' && r[3] === '01711000001' && r[4] === 'Guardian A'), 'short balance ID থেকে full Member No + কল/details মেলে');
ok(result.rows.some(r => r[1] === '3333') && result.rows.some(r => r[1] === '4444'), 'installment-only ও nonzero DPS সদস্য রক্ষিত');
ok(!result.rows.some(r => r[1] === '2222') && result.rows.every(r => r.length === 5), 'inactive row বাদ এবং সব row compact ৫-column');
ok(JSON.stringify(result.headers) === JSON.stringify(COMPACT_HEADERS), 'compact headers স্থির');
const again = compactActiveMembers({ ...input, memberDBHeaders: result.headers, memberDB: result.rows });
ok(again.stats.after === 3 && again.stats.removed === 0 && JSON.stringify(again.rows) === JSON.stringify(result.rows), 'repeat pruning idempotent');
const unavailable = compactActiveMembers({ memberDBHeaders: headers, memberDB: members, balanceHeaders: [], balanceRows: [], installmentHeaders: [], installmentRows: [] });
ok(unavailable.skipped && unavailable.rows.length === 4, 'active data unavailable হলে directory খালি হয় না');
const allZero = compactActiveMembers({ memberDBHeaders: headers, memberDB: members, balanceHeaders, balanceRows: [balanceRows[1]], installmentHeaders: [], installmentRows: [] });
ok(!allZero.skipped && allZero.rows.length === 0 && allZero.stats.removed === 4, 'সত্যিকারের all-zero balance হলে inactive contact বাদ');

if (fs.existsSync('./preview-data.json')) {
  const fixture = JSON.parse(fs.readFileSync('./preview-data.json', 'utf8'));
  const daily = fixture.dailyData;
  const current = compactActiveMembers({
    memberDBHeaders: daily.memberDBHeaders, memberDB: daily.memberDB,
    balanceHeaders: daily.balanceHeaders, balanceRows: daily.balanceRows,
    installmentHeaders: fixture.headers, installmentRows: fixture.rows,
  });
  ok(current.stats.before === 5081 && current.stats.after === 914 && current.stats.removed === 4167,
    'current fixture: 5,081 → 914 active compact contacts', current.stats);
  ok(current.stats.activeBalanceRows === 913 && current.stats.installmentSources === 484,
    '913 nonzero balance + 484 current installment source অক্ষত', current.stats);
  ok(current.rows.every(r => r.length === 5) && current.rows.filter(r => r[3] && r[3] !== 'nA').length > 700,
    'current compact set-এ প্রয়োজনীয় call data থাকে');
}
console.log(`\nActive-only tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
