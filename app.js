/* =========================================================
   কালেকশন ম্যানেজার — কিস্তি রিপোর্ট (CSV)
   - CSV অটো-ডিটেক্ট (কোনো সিলেকশন/ম্যাপিং নেই)
   - ৩ টেবিল: বাকী কিস্তি · আদায় কিস্তি · আংশিক কিস্তি
       · InstallmentActual = 0                  → বাকী
       · InstallmentActual <  InstallmentAmount → আংশিক
       · InstallmentActual >= InstallmentAmount → আদায়
   - ফিল্টার: ষ্টাফ · সেন্টার কোড · মেম্বার কোড · তারিখ
   - Neon PostgreSQL-এ একমাত্র persistent data storage
   ========================================================= */
'use strict';

/* ---------------- Utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]
));
const norm = (v) => toEn(String(v ?? '')).trim().toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const BN_DIGIT = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const toEn = (s) => String(s ?? '').replace(/[০-৯]/g, (d) => BN_DIGIT[d]);
const num = (v) => {
  const n = parseFloat(toEn(String(v ?? '')).replace(/[৳,\sTk]/gi, ''));
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n * 100) / 100;
  return Number.isFinite(rounded) ? rounded : 0;
};
const fmt = (n) => Number(n || 0).toLocaleString('bn-BD', { maximumFractionDigits: 2 });
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
// UI-তে শুধু শেষ ৪টি মেম্বার সংখ্যা ও শেষ ৩টি সেন্টার সংখ্যা দেখাই; সংরক্ষিত মূল কোড অপরিবর্তিত থাকে।
const trailingDigits = (value) => toEn(String(value ?? '').trim()).match(/(\d+)$/)?.[1] || '';
const displayMemberCode = (value) => {
  const code = String(value ?? '').trim();
  const digits = trailingDigits(code);
  return digits.length >= 4 ? digits.slice(-4) : code;
};
const displayCenterCode = (value) => {
  const code = String(value ?? '').trim().split(',')[0].trim();
  const digits = trailingDigits(code);
  return digits.length >= 3 ? digits.slice(-3) : code;
};
// A→Z (ছোট থেকে বড়) সাজানো: কোডের সংখ্যা অংশ অনুযায়ী, নয়তো বাংলা অনুযায়ী।
const compareAZ = (a, b) => {
  const left = String(a ?? '').trim(), right = String(b ?? '').trim();
  const ld = toEn(left).match(/\d+/)?.[0], rd = toEn(right).match(/\d+/)?.[0];
  if (ld && rd) {
    const ln = Number(ld), rn = Number(rd);
    if (Number.isFinite(ln) && Number.isFinite(rn) && ln !== rn) return ln - rn;
  }
  return left.localeCompare(right, 'bn');
};
const sortAZ = (values) => [...values].sort(compareAZ);
// মেম্বার কোড তুলনা (UI-তে দেখানো শেষ ৪ সংখ্যা অনুযায়ী, সমান হলে মূল কোড অনুযায়ী)।
const compareMemberCodes = (a, b) => compareAZ(displayMemberCode(a), displayMemberCode(b)) || compareAZ(a, b);
// কিস্তি-সারিগুলো মেম্বার কোড অনুযায়ী ছোট থেকে বড় সাজানো।
function sortRowsAZ(rows) {
  const d = state.detect;
  return [...rows].sort((a, b) => {
    if (d.memberCode >= 0) {
      const cmp = compareMemberCodes(a[d.memberCode], b[d.memberCode]);
      if (cmp !== 0) return cmp;
    }
    if (d.memberName >= 0) {
      const cmp = compareAZ(a[d.memberName], b[d.memberName]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

const toISODate = (v) => {
  const s = toEn(String(v ?? '')).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // dd/mm/yyyy (বাংলাদেশ)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // dd/mm/yy
  return '';
};
/* সারির "তারিখ" কলামের মান → আইসো তারিখ (YYYY-MM-DD) */
function rowDateISO(row) {
  const d = state.detect;
  if (d.date < 0) return '';
  return toISODate(String(row[d.date] ?? '').trim());
}
/* তারিখ দেখানোর জন্য ছোট ফরম্যাট (dd-mm-yy) */
const shortDate = (value) => {
  const iso = toISODate(String(value ?? '').trim());
  if (!iso) return String(value ?? '').trim();
  const [y, m, day] = iso.split('-');
  return `${day}-${m}-${y.slice(2)}`;
};

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

/* ---------------- Settings: Neon is the only data store ---------------- */
const SET_KEY = 'collectionManager.settings.v1';
const APP_VER = 'v9.42';
// নতুন ভার্সন প্রকাশের পরে খোলা থাকা ট্যাবে পুরোনো app.js ক্যাশ থেকে চলতে না পারে —
// একবার রিফ্রেশ করে নতুন অ্যাসেট আনা হয় (প্রথমবার লোডে রিফ্রেশ হয় না)।
try {
  const buildKey = 'collectionManager.build.v1';
  const storedBuild = localStorage.getItem(buildKey);
  localStorage.setItem(buildKey, APP_VER);
  if (storedBuild && storedBuild !== APP_VER) location.reload();
} catch { /* localStorage না থাকলে চলবে */ }
const defaultSettings = () => ({ mode: 'neon', autoRefresh: true, refreshSec: 10 });
let previousSettings = {};
try {
  const parsedSettings = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
  if (parsedSettings && typeof parsedSettings === 'object' && !Array.isArray(parsedSettings)) previousSettings = parsedSettings;
} catch { /* পুরোনো/ভাঙা সেটিংস হলে ডিফল্ট ব্যবহার */ }
let settings = { ...defaultSettings(), ...previousSettings, mode: 'neon' };
const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify({
  mode: 'neon',
  autoRefresh: Boolean(settings.autoRefresh),
  refreshSec: Math.max(8, Math.min(3600, num(settings.refreshSec) || 10)),
}));
// আগের GitHub token/owner setting থেকে বাদ পড়ে; কোনো collection data মোছা হয় না।
saveSettings();
// Clear any access code retained by older versions; API is intentionally public.
try { sessionStorage.removeItem('collectionManager.neonAccessKey.v1'); } catch {}
const MEMBER_DB_KEY = 'collectionManager.memberDirectory.v1';
const TODAY_ROWS_KEY = 'collectionManager.todayCollections.v1';
const BALANCE_DB_KEY = 'collectionManager.balanceDirectory.v1';
const PAID_ARCHIVE_KEY = 'collectionManager.paidArchive.v1';
const STAFF_DB_KEY = 'collectionManager.staffDirectory.v1';
const IDENTITY_KEY = 'collectionManager.identity.v1';
const OUTBOX_KEY = 'collectionManager.offlineOutbox.v1';

/* ---------------- Neon API (database URL stays server-side) ---------------- */
const NEON_API = '/api/data';

async function neonResponseError(res) {
  let message = '';
  try { message = (await res.json()).error || ''; } catch { /* non-JSON response */ }
  let error;
  if (res.status === 404) error = new Error('Neon API endpoint পাওয়া যায়নি। সার্ভার ফাংশনসহ সাইটটি deploy হয়েছে কি না দেখুন।');
  else if (res.status === 503) error = new Error(message || 'Neon সার্ভার কনফিগার করা নেই—সার্ভার environment variables পরীক্ষা করুন।');
  else error = new Error(message || `Neon API ${res.status}`);
  error.status = res.status;
  return error;
}

async function neonRead() {
  const res = await fetch(NEON_API, { cache: 'no-store' });
  if (!res.ok) throw await neonResponseError(res);
  return res.json();
}

async function neonWrite(document) {
  const res = await fetch(NEON_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
  });
  if (!res.ok) throw await neonResponseError(res);
  return res.json();
}

/* হালকা মেটা — কয়েকশো বাইট, প্রতি ১০ সেকেন্ডে নিরাপদে ডাকা যায় (লাইভ সিঙ্ক) */
async function neonMeta() {
  const res = await fetch(NEON_API + '?meta=1', { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

/* আংশিক লেখা — শুধু বদলানো অংশ যায়, তাই সেভ প্রায় সাথে সাথে */
let patchSupported = true;
async function neonPatch(patch) {
  if (!patchSupported) return null;
  const res = await fetch(NEON_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch }),
  });
  if (res.status === 404 || res.status === 405 || res.status === 501) { patchSupported = false; return null; }
  if (!res.ok) throw await neonResponseError(res);
  return res.json();
}

/* ---------------- CSV parser ---------------- */
function detectDelimiter(line) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestCount = 0;
  for (const d of candidates) {
    const count = line.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function parseCSV(text, delimiter) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delimiter) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); if (row.some((v) => v.trim() !== '')) rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); if (row.some((v) => v.trim() !== '')) rows.push(row); }
  return rows;
}

/* ---------------- কলাম অটো-ডিটেক্ট (কোনো সিলেকশন নেই) ---------------- */
function normHeader(h) {
  return toEn(String(h ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* MIS/অফিস-রিপোর্টের অপ্রয়োজনীয় কলাম (SLNo, OfficeID, OfficeCode, OfficeName,
   ProductCode, ProductName, MainProductCode, MainItemName, EmployeeCode, SCBalance,
   Remarks, LoanSummaryID) ডিটেইলসে দেখানো হয় না — এগুলো লাগে না। */
const NOISE_COLUMN_PATTERNS = [
  /^sl/, /^sno$/, /^serial/, /office/, /product/, /^mainitem/,
  /employeecode/, /^scbalance/, /remark/, /loansummaryid/,
];
function isNoiseColumn(label) {
  const key = normHeader(label);
  if (!key) return false;
  return NOISE_COLUMN_PATTERNS.some((pattern) => pattern.test(key));
}

/* কিস্তি তালিকার সদস্য-বিস্তারিত কার্ড থেকে বাদ দেওয়া তথ্য —
   STATUS, MEMBER TYPE এবং INTCHARGE / NOOFFULLPAYMENT / NOOFPARTIALPAYMENT / NOOFNOTPAYMENT
   ব্যবহারকারীর নির্দেশে আর দেখানো হয় না (ডেটা মুছে যায় না, শুধু মডালে লুকানো)। */
const HIDDEN_DETAIL_KEYS = new Set([
  'status', 'membertype',
  'intcharge', 'nooffullpayment', 'noofpartialpayment', 'noofnotpayment',
]);
function stripHiddenDetails(entries) {
  const out = [];
  (Array.isArray(entries) ? entries : []).forEach((item) => {
    if (!item) return;
    // শিরোনামহীন কলাম ("তথ্য —") মডালে অগোছালো দেখায় — বাদ
    if (!item.divider && !item.hint && !String(item.label || '').trim()) return;
    if (!item.divider && !item.hint && HIDDEN_DETAIL_KEYS.has(normHeader(item.label))) return;
    out.push(item);
  });
  // সব কার্ড বাদ পড়ে কোনো হেডিং ফাঁকা হয়ে গেলে হেডিংটাও সরানো হয়
  return out.filter((item, index) => {
    if (!item.divider) return true;
    const next = out[index + 1];
    return Boolean(next && !next.divider);
  });
}

function detectColumns(headers) {
  const n = headers.map(normHeader);
  const pick = (test) => {
    let best = -1, bestScore = 0;
    n.forEach((h, i) => {
      const s = test(h) || 0;
      if (s > bestScore) { bestScore = s; best = i; }
    });
    return bestScore >= 40 ? best : -1;
  };
  const has = (h, ...ws) => ws.every((w) => h.includes(w));

  const actual = pick((h) =>
    h === 'installmentactual' || h === 'actualinstallment' ? 120 :
    (has(h, 'installment', 'actual') || has(h, 'instalment', 'actual')) && !h.includes('date') ? 100 :
    h.includes('actual') && !h.includes('date') ? 75 :
    has(h, 'paid', 'amount') || has(h, 'received', 'amount') || has(h, 'collection', 'amount') ? 60 : 0);

  const amount = pick((h) => {
    if (h === n[actual]) return 0;
    return (has(h, 'installment', 'amount') || has(h, 'instalment', 'amount')) && !h.includes('actual') ? 100 :
      (has(h, 'installmentamount') && !h.includes('actual')) ? 95 :
      has(h, 'due', 'amount') ? 70 :
      (h.includes('installment') || h.includes('instalment')) && !h.includes('actual') ? 65 :
      h === 'amount' || h === 'kisti' ? 55 :
      has(h, 'total', 'amount') ? 45 : 0;
  });

  const staff = pick((h) =>
    has(h, 'employee') ? 100 :
    has(h, 'staff') ? 95 :
    has(h, 'officer') ? 85 :
    has(h, 'collector') ? 80 :
    has(h, 'empcode') || has(h, 'empno') || has(h, 'empid') ? 75 : 0);

  const centerCode = pick((h) =>
    has(h, 'center', 'code') || has(h, 'centre', 'code') ? 100 :
    has(h, 'center', 'id') || has(h, 'centre', 'id') || has(h, 'center', 'no') || has(h, 'centre', 'no') ? 90 :
    h === 'center' || h === 'centre' || h === 'centercode' ? 60 : 0);

  const centerName = pick((h) => (has(h, 'center', 'name') || has(h, 'centre', 'name') ? 100 : 0));

  const memberCode = pick((h) =>
    has(h, 'member', 'code') || has(h, 'member', 'no') || has(h, 'member', 'id') || has(h, 'member', 'number') ? 100 :
    has(h, 'customer', 'code') || has(h, 'customer', 'no') || has(h, 'customer', 'id') ||
    has(h, 'client', 'code') || has(h, 'client', 'id') || has(h, 'borrower') ? 90 :
    has(h, 'memcode') || has(h, 'mcode') || has(h, 'custcode') || has(h, 'custid') ? 85 :
    has(h, 'loanaccount') || has(h, 'accountno') || has(h, 'accountnumber') || has(h, 'acno') ||
    has(h, 'loanid') || has(h, 'loanno') ? 80 :
    h === 'code' || h === 'id' ? 55 : 0);

  const memberName = pick((h) =>
    has(h, 'member', 'name') || has(h, 'customer', 'name') || has(h, 'client', 'name') || has(h, 'borrower', 'name') ? 100 :
    h.endsWith('name') && (h.includes('cust') || h.includes('mem') || h.includes('client')) ? 90 :
    h === 'name' || h === 'membername' ? 55 :
    (h.endsWith('name') && !h.includes('item') && !h.includes('product') &&
     !h.includes('center') && !h.includes('centre') && !h.includes('staff') && !h.includes('emp')) ? 45 : 0);

  const date = pick((h) =>
    // "Installment Date Actual" হলো আদায়ের তারিখ (বেশিরভাগ সারিতে খালি) — কিস্তির তারিখ নয়,
    // তাই "Installment Start Date"-এর চেয়ে কম গুরুত্ব পায়।
    has(h, 'installment', 'date') || has(h, 'instalment', 'date') ? (h.includes('actual') ? 90 : 105) :
    has(h, 'date', 'actual') || has(h, 'actual', 'date') ? 100 :
    has(h, 'due', 'date') ? 95 :
    has(h, 'paid', 'date') || has(h, 'payment', 'date') ? 90 :
    h.includes('date') ? 70 : 0);

  /* আসল টাকা আসার তারিখ আলাদা — Installment Start Date-এর সঙ্গে গুলিয়ে ফেলা যাবে না। */
  const paidDate = pick((h) =>
    h === 'installmentdateactual' || h === 'instalmentdateactual' ? 140 :
    (has(h, 'installment', 'date', 'actual') || has(h, 'instalment', 'date', 'actual')) ? 130 :
    has(h, 'paid', 'date') || has(h, 'payment', 'date') || has(h, 'collection', 'date') ? 110 :
    has(h, 'actual', 'date') || has(h, 'date', 'actual') ? 100 : 0);

  const staffName = pick((h) =>
    has(h, 'emp', 'name') || has(h, 'employee', 'name') || has(h, 'staff', 'name') ? 100 : 0);

  const mobileEnglish = pick((h) =>
    h.includes('mobile') ? 120 :
    h.includes('phone') ? 110 :
    h.includes('cell') ? 90 :
    h.includes('contact') ? 75 : 0);
  const mobileBangla = headers.findIndex((h) => /মোবাইল|মুঠোফোন|ফোন|যোগাযোগ/u.test(String(h ?? '')));
  const mobile = mobileEnglish >= 0 ? mobileEnglish : mobileBangla;

  return { actual, amount, staff, staffName, centerCode, centerName, memberCode, memberName, mobile, date, paidDate };
}

const DETECT_LABELS = [
  ['actual', 'আদায় (InstallmentActual)'],
  ['amount', 'কিস্তি (InstallmentAmount)'],
  ['staff', 'ষ্টাফ কোড'],
  ['staffName', 'ষ্টাফ নাম'],
  ['centerCode', 'সেন্টার কোড'],
  ['memberCode', 'মেম্বার কোড'],
  ['memberName', 'মেম্বার নাম'],
  ['mobile', 'মোবাইল নম্বর'],
  ['date', 'তারিখ'],
  ['centerName', 'সেন্টার নাম'],
];

/* ---------------- App state ---------------- */
const state = {
  headers: [],          // CSV হেডার
  rows: [],             // [[cell, cell, ...], ...]
  detect: {},           // { actual, amount, staff, ... } → কলাম ইনডেক্স
  filters: { staff: '', center: '', member: '', searchBy: 'memberCode', date: '', followup: '', followupDate: '' },
  sectionView: 'all',
  editingToday: -1,
  editingTodayId: '',
  editingHistoryId: '',
  todayRawMember: '',   // সদস্য ডিরেক্টরি থেকে পাওয়া মূল কোড (UI-তে শেষ ৪ সংখ্যা দেখায়)
  todayRawCenter: '',
  collections: [],      // আদায়ের পৃথক লেনদেন-তালিকা
  followups: [],        // সদস্যের প্রতিশ্রুতি ও পরবর্তী তারিখ
  activePage: 'today',
  todayReturnPage: '',
  todayInstallmentKey: '',
  memberDB: [],
  memberDBHeaders: [],
  todayRows: [],
  staffDirectory: [],   // report বদলালেও staff নাম ও পরিচিত center mapping টিকে থাকে
  history: [],          // হিসাব ক্লোজ করা এন্ট্রি (তারিখভিত্তিক স্থায়ী খাতা)
  paidArchive: [],      // আদায় সম্পূর্ণ হওয়া কিস্তির স্থায়ী, ডুপ্লিকেট-মুক্ত আর্কাইভ
  balanceRows: [],
  balanceHeaders: [],
  csvData: null,        // আপলোডের সময়ের কাজচলা কপি
  lastSync: null,
  identity: null,
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  needsCanonicalSync: false,
  outbox: [],
};

/* Sync-এ Today list-এর index বদলাতে পারে। চলমান edit-এর target তাই index নয়,
   stable entry ID থেকে প্রতিবার নির্ণয় করি। */
function resolveTodayEditIndex() {
  const id = String(state.editingTodayId || '');
  if (id) return state.todayRows.findIndex((item) => String(item?.id || '') === id);
  return Number.isInteger(state.editingToday) ? state.editingToday : -1;
}
function clearTodayEditTarget() {
  state.editingToday = -1;
  state.editingTodayId = '';
}

const DEVICE_KEY = 'collectionManager.deviceId.v1';
let deviceId = '';
try {
  deviceId = localStorage.getItem(DEVICE_KEY) || '';
  if (!deviceId) { deviceId = uid(); localStorage.setItem(DEVICE_KEY, deviceId); }
} catch { deviceId = uid(); }
try { const savedIdentity = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null'); if (savedIdentity?.role) state.identity = savedIdentity; } catch {}
if (!state.identity) state.identity = { role: 'admin', staff: '', label: 'Admin' };
try { const pending = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); state.outbox = Array.isArray(pending) ? pending : []; } catch {}

function effectiveRole() { return state.identity?.role || 'admin'; }
function selectedStaffName() { return effectiveRole() === 'staff' ? String(state.identity?.staff || '').trim() : ''; }
function canUpdateDatabase() { return effectiveRole() === 'admin'; }
function requireAdminOnline() {
  if (!canUpdateDatabase()) { toast('Database upload/update শুধু Admin করতে পারবেন।', true); return false; }
  if (!state.isOnline) { toast('Database upload/update করতে internet চালু করুন। অফলাইনে শুধু আদায় এন্ট্রি সেভ হবে।', true); return false; }
  return true;
}
function canCollect() { return effectiveRole() !== 'manager'; }
function roleLabel(role = effectiveRole()) { return role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Staff'; }
function rowStaffName(row) {
  const index = state.detect.staffName >= 0 ? state.detect.staffName : state.detect.staff;
  return index >= 0 && row ? String(row[index] || '').trim() : '';
}
function learnStaffDirectory() {
  const records = new Map();
  const add = (name, center = '', member = '') => {
    name = String(name || '').trim();
    if (!name) return;
    if (!records.has(name)) records.set(name, { name, centers: new Set(), members: new Set() });
    const record = records.get(name);
    const centerKey = normalizedDigits(String(center || '').split(',')[0]).replace(/^0+/, '');
    const memberKeyValue = memberCodeKey(member);
    if (centerKey) record.centers.add(centerKey);
    if (memberKeyValue) record.members.add(memberKeyValue);
  };
  for (const old of state.staffDirectory || []) {
    const name = typeof old === 'string' ? old : old?.name;
    add(name);
    const record = records.get(String(name || '').trim());
    if (record && old && typeof old === 'object') {
      (Array.isArray(old.centers) ? old.centers : []).forEach((center) => add(name, center));
      (Array.isArray(old.members) ? old.members : []).forEach((member) => add(name, '', member));
    }
  }
  state.rows.forEach((row) => add(rowStaffName(row), state.detect.centerCode >= 0 ? row[state.detect.centerCode] : '', state.detect.memberCode >= 0 ? row[state.detect.memberCode] : ''));
  state.paidArchive.forEach((item) => add(item.staffName || item.ownerStaff, item.centerCode, item.memberCode));
  [...state.todayRows, ...state.history].forEach((item) => add(item.ownerStaff || item.staffName, item.centerCode, item.memberCode));
  state.staffDirectory = [...records.values()].map((record) => ({
    name: record.name,
    centers: [...record.centers].sort(),
    members: [...record.members].sort(),
  })).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
}
function staffNames() {
  const names = new Set();
  (state.staffDirectory || []).forEach((item) => { const name = typeof item === 'string' ? item : item?.name; if (String(name || '').trim()) names.add(String(name).trim()); });
  state.rows.forEach((row) => { const name = rowStaffName(row); if (name) names.add(name); });
  state.paidArchive.forEach((item) => { const name = String(item.staffName || item.ownerStaff || '').trim(); if (name) names.add(name); });
  [...state.todayRows, ...state.history].forEach((item) => { const name = String(item.ownerStaff || item.staffName || '').trim(); if (name) names.add(name); });
  return [...names].sort((a, b) => a.localeCompare(b, 'bn'));
}
/* Staff mapping একবার তৈরি করে reuse করি। ৫,০০০+ directory row-এর প্রতিটি
   keystroke-এ ৪৮৪ installment row আবার scan করলে ফোন freeze করে। */
let staffLookupCache = null;
function getStaffLookup() {
  const archive = state.paidArchive;
  if (staffLookupCache
    && staffLookupCache.rows === state.rows
    && staffLookupCache.directory === state.staffDirectory
    && staffLookupCache.archive === archive
    && staffLookupCache.archiveLength === archive.length
    && staffLookupCache.memberColumn === state.detect.memberCode
    && staffLookupCache.centerColumn === state.detect.centerCode) return staffLookupCache;

  const memberStaff = new Map();
  const directoryMembers = new Map();
  const centerNames = new Map();
  const addCenter = (center, staff) => {
    const key = normalizedDigits(center).replace(/^0+/, '');
    const name = String(staff || '').trim();
    if (!key || !name) return;
    if (!centerNames.has(key)) centerNames.set(key, new Set());
    centerNames.get(key).add(name);
  };
  if (state.detect.memberCode >= 0) state.rows.forEach((row) => {
    const name = rowStaffName(row);
    const key = memberCodeKey(row[state.detect.memberCode]);
    /* পুরোনো আচরণ: প্রথম matching row-এর staff (খালি হলেও) চূড়ান্ত। */
    if (key && !memberStaff.has(key)) memberStaff.set(key, name);
  });
  if (state.detect.centerCode >= 0) state.rows.forEach((row) => addCenter(row[state.detect.centerCode], rowStaffName(row)));
  (state.staffDirectory || []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const name = String(item.name || '').trim();
    (Array.isArray(item.members) ? item.members : []).forEach((member) => {
      const key = memberCodeKey(member);
      if (!key || !name) return;
      if (!directoryMembers.has(key)) directoryMembers.set(key, new Set());
      directoryMembers.get(key).add(name);
    });
    (Array.isArray(item.centers) ? item.centers : []).forEach((center) => addCenter(center, name));
  });
  archive.forEach((item) => addCenter(item.centerCode, item.staffName || item.ownerStaff));
  directoryMembers.forEach((names, key) => {
    if (names.size === 1 && !memberStaff.has(key)) memberStaff.set(key, [...names][0]);
  });
  const centerStaff = new Map();
  centerNames.forEach((names, key) => { if (names.size === 1) centerStaff.set(key, [...names][0]); });
  staffLookupCache = {
    rows: state.rows, directory: state.staffDirectory, archive, archiveLength: archive.length,
    memberColumn: state.detect.memberCode, centerColumn: state.detect.centerCode,
    memberStaff, centerStaff,
  };
  return staffLookupCache;
}
function currentStaffForMember(memberCode) {
  const key = memberCodeKey(memberCode);
  if (!key || state.detect.memberCode < 0) return '';
  return getStaffLookup().memberStaff.get(key) || '';
}
function staffForCenter(centerCode) {
  const key = normalizedDigits(centerCode).replace(/^0+/, '');
  if (!key) return '';
  return getStaffLookup().centerStaff.get(key) || '';
}
function staffForMemberCode(memberCode, centerHint = '') {
  const direct = currentStaffForMember(memberCode);
  if (direct) return direct;
  const key = memberCodeKey(memberCode);
  const entry = [...state.todayRows, ...state.history, ...state.paidArchive].find((item) => memberCodeKey(item.memberCode) === key && String(item.ownerStaff || item.staffName || '').trim());
  if (entry) return String(entry.ownerStaff || entry.staffName).trim();
  const directory = findDirectoryMember(memberCode, centerHint);
  const centerIndex = memberCol(state.memberDBHeaders, 'center');
  const center = centerHint || (directory && centerIndex >= 0 ? String(directory[centerIndex] || '').split(',')[0] : '');
  return staffForCenter(center);
}
function directoryStaff(row) {
  const codeIndex = memberCol(state.memberDBHeaders, 'code');
  const centerIndex = memberCol(state.memberDBHeaders, 'center');
  const code = codeIndex >= 0 ? row[codeIndex] : '';
  const center = centerIndex >= 0 ? String(row[centerIndex] || '').split(',')[0] : '';
  return currentStaffForMember(code) || staffForCenter(center);
}
function directoryRowVisible(row) { const staff = selectedStaffName(); return !staff || directoryStaff(row) === staff; }
function rowBelongsToSelectedStaff(row) { const staff = selectedStaffName(); return !staff || rowStaffName(row) === staff; }
function entryOwnerStaff(item) {
  return String(item?.ownerStaff || item?.staffName || '').trim() || staffForMemberCode(item?.memberCode, item?.centerCode) || staffForCenter(item?.centerCode);
}
function entryVisibleToIdentity(item) { const staff = selectedStaffName(); return !staff || entryOwnerStaff(item) === staff; }
function canEditEntry(item) { return effectiveRole() === 'admin' || (effectiveRole() === 'staff' && entryVisibleToIdentity(item)); }
function canEditHistoryEntry(item) { return canEditEntry(item); }
function staffMemberAllowed(memberCode, centerCode = '') {
  if (effectiveRole() !== 'staff') return true;
  const owner = staffForMemberCode(memberCode, centerCode);
  return !owner || owner === selectedStaffName();
}

function saveOutbox() { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(state.outbox)); } catch {} }
function queueOperation(patch, document) {
  state.outbox.push({ id: uid(), queuedAt: new Date().toISOString(), patch, document });
  saveOutbox(); updateSyncStatus();
}
async function pushQueuedOperation(job) {
  if (job.patch) {
    const result = await neonPatch(job.patch);
    if (!result) throw new Error('এই server-এ incremental sync নেই—নতুন সংস্করণ deploy করুন।');
    return result;
  }
  if (!job.document) throw new Error('Offline operation-এর document পাওয়া যায়নি।');
  return neonWrite(job.document);
}
let flushPromise = null;
async function flushOutbox() {
  if (flushPromise) return flushPromise;
  if (!state.isOnline || !state.outbox.length) return 0;
  flushPromise = (async () => {
    let sent = 0;
    while (state.outbox.length) {
      await pushQueuedOperation(state.outbox[0]);
      state.outbox.shift(); sent += 1; saveOutbox(); updateSyncStatus();
    }
    return sent;
  })();
  try { return await flushPromise; } finally { flushPromise = null; }
}
let backgroundFlushTimer = null;
function scheduleBackgroundFlush() {
  clearTimeout(backgroundFlushTimer);
  /* প্রথমে UI render/toast শেষ হোক; network পরের tick-এ শুরু হবে। */
  backgroundFlushTimer = setTimeout(async () => {
    if (!state.isOnline || !state.outbox.length) { updateSyncStatus(); return; }
    try {
      const sent = await flushOutbox();
      if (sent) {
        state.lastSync = new Date();
        state.needsCanonicalSync = true;
        renderHeader();
        /* Flush শেষ হওয়ার ঠিক আগে নতুন operation এসে থাকলে সেটিও পাঠাই। */
        if (state.outbox.length) scheduleBackgroundFlush();
      }
    } catch { updateSyncStatus(); }
  }, 25);
}
function updateSyncStatus() {
  const badge = $('#offline-badge');
  const pending = state.outbox.length;
  if (badge) {
    badge.className = 'sync-badge ' + (state.isOnline ? (pending ? 'pending' : 'online') : 'offline');
    badge.textContent = state.isOnline ? (pending ? `⏳ ${fmt(pending)} sync বাকী` : '● অনলাইন') : `○ অফলাইন${pending ? ` · ${fmt(pending)}` : ''}`;
  }
  const syncStatus = $('#sync-status');
  if (syncStatus && (!state.isOnline || pending)) {
    syncStatus.textContent = state.isOnline ? `⏳ ${fmt(pending)}টি operation sync বাকী` : `📴 অফলাইন · স্থানীয় ডেটা${pending ? ` · ${fmt(pending)}টি operation বাকী` : ''}`;
  }
  const identityStatus = $('#identity-status');
  if (identityStatus) identityStatus.textContent = state.isOnline ? 'নাম বা ভূমিকা বেছে প্রবেশ করুন।' : 'অফলাইন আছেন—সেভ করা এন্ট্রি internet এলে auto-sync হবে।';
}
function hashEntrySignature(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
function ensureEntryIds() {
  const used = new Set(), counts = new Map();
  for (const [prefix, list] of [['t', state.todayRows], ['h', state.history]]) {
    for (const item of list) {
      const signature = JSON.stringify([item.date, item.memberCode, item.installmentKey, item.createdAt || item.closedAt, item.loan, item.savings, item.dps, item.total]);
      const occurrence = counts.get(signature) || 0; counts.set(signature, occurrence + 1);
      if (!item.id) item.id = `${prefix}-${hashEntrySignature(signature + '|' + occurrence)}`;
      item.id = String(item.id);
      if (used.has(item.id)) item.id = `${item.id}-${occurrence + 1}`;
      used.add(item.id);
      if (!item.ownerStaff) item.ownerStaff = staffForMemberCode(item.memberCode, item.centerCode);
      if (!item.ownerRole) item.ownerRole = 'staff';
    }
  }
}

// Use browser copies only as a one-time migration fallback; Neon is the shared source thereafter.
try { const m = JSON.parse(localStorage.getItem(MEMBER_DB_KEY) || '{}'); state.memberDBHeaders = Array.isArray(m.headers) ? m.headers : []; state.memberDB = Array.isArray(m.rows) ? m.rows : []; } catch {}
try { const t = JSON.parse(localStorage.getItem(TODAY_ROWS_KEY) || '[]'); state.todayRows = Array.isArray(t) ? t : []; } catch {}
try { const b = JSON.parse(localStorage.getItem(BALANCE_DB_KEY) || '{}'); state.balanceHeaders = Array.isArray(b.headers) ? b.headers : []; state.balanceRows = Array.isArray(b.rows) ? b.rows : []; } catch {}
try { const a = JSON.parse(localStorage.getItem(PAID_ARCHIVE_KEY) || '[]'); state.paidArchive = Array.isArray(a) ? a : []; } catch {}
try { const s = JSON.parse(localStorage.getItem(STAFF_DB_KEY) || '[]'); state.staffDirectory = Array.isArray(s) ? s : []; } catch {}

/* ---------------- ক্লাসিফিকেশন ---------------- */
function rowStatus(r) {
  const d = state.detect;
  const actual = num(r[d.actual]);
  const amount = d.amount >= 0 ? num(r[d.amount]) : 0;
  if (actual <= 0) return 'due';
  if (d.amount >= 0 && amount > 0 && actual < amount) return 'partial';
  return 'paid';
}

const countByStatus = (rows) => {
  const out = { due: 0, paid: 0, partial: 0 };
  for (const r of rows) out[rowStatus(r)]++;
  return out;
};

/* ---------------- আদায় কিস্তির স্থায়ী আর্কাইভ ----------------
   current rows মাস বদলে replace হলেও এই তালিকা replace হয় না।
   LoanSummaryID + কিস্তির তারিখ + মেম্বার দিয়ে স্থায়ী key; পুরোনো রিপোর্টে
   LoanSummaryID না থাকলে মেম্বার + তারিখ + অঙ্ক + সেন্টার ব্যবহার হয়। */
function rowPaidDateISO(row) {
  const d = state.detect;
  if (!row || !Number.isInteger(d.paidDate) || d.paidDate < 0) return '';
  return toISODate(row[d.paidDate]);
}
function paidArchiveBaseKey(row) {
  const d = state.detect;
  const member = d.memberCode >= 0 ? normalizedDigits(row[d.memberCode]).replace(/^0+/, '') : '';
  const dueDate = rowDateISO(row) || (d.date >= 0 ? norm(row[d.date]) : '');
  const center = d.centerCode >= 0 ? norm(row[d.centerCode]) : '';
  const amount = d.amount >= 0 ? num(row[d.amount]) : 0;
  const loanIndex = state.headers.findIndex((header) => {
    const key = normHeader(header);
    return key === 'loansummaryid' || key === 'loanaccount' || key === 'loanaccountnumber';
  });
  const loanId = loanIndex >= 0 ? norm(row[loanIndex]) : '';
  if (loanId) return `loan:${loanId}|member:${member}|due:${dueDate}`;
  return `member:${member}|due:${dueDate}|center:${center}|amount:${amount}`;
}
function paidArchiveKey(row) {
  const base = paidArchiveBaseKey(row);
  let occurrence = 0;
  for (const candidate of state.rows) {
    if (candidate === row) break;
    if (paidArchiveBaseKey(candidate) === base) occurrence += 1;
  }
  return `${base}|occ:${occurrence}`;
}
function paidArchiveRecord(row, previous = null) {
  const d = state.detect;
  const read = (index) => index >= 0 ? String(row[index] ?? '').trim() : '';
  return {
    key: paidArchiveKey(row),
    memberCode: read(d.memberCode),
    memberName: read(d.memberName),
    centerCode: read(d.centerCode),
    centerName: read(d.centerName),
    staffName: read(d.staffName >= 0 ? d.staffName : d.staff),
    installmentDate: rowDateISO(row),
    paidDate: rowPaidDateISO(row) || previous?.paidDate || '',
    amount: d.amount >= 0 ? num(row[d.amount]) : 0,
    actual: num(row[d.actual]),
    archivedAt: previous?.archivedAt || new Date().toISOString(),
  };
}
function archiveCurrentPaidInstallments() {
  if (!state.rows.length || !Number.isInteger(state.detect.actual) || state.detect.actual < 0) return false;
  if (!Array.isArray(state.paidArchive)) state.paidArchive = [];
  let changed = false;
  for (const row of state.rows) {
    if (rowStatus(row) !== 'paid') continue;
    const key = paidArchiveKey(row);
    const index = state.paidArchive.findIndex((item) => item && item.key === key);
    const previous = index >= 0 ? state.paidArchive[index] : null;
    const record = paidArchiveRecord(row, previous);
    if (index < 0) {
      state.paidArchive.push(record);
      changed = true;
    } else if (JSON.stringify(previous) !== JSON.stringify(record)) {
      state.paidArchive[index] = record;
      changed = true;
    }
  }
  return changed;
}
/* এডিট/ডিলিটে আদায় আংশিক বা বাকী হয়ে গেলে ওই current কিস্তির আর্কাইভ বাতিল হয়;
   নতুন মাসের upload-এ এই reconciliation চালানো হয় না—তাই পুরোনো মাস টিকে থাকে। */
function reconcilePaidArchiveRow(row) {
  if (!row || !Array.isArray(state.paidArchive)) return false;
  if (rowStatus(row) === 'paid') return archiveCurrentPaidInstallments();
  const key = paidArchiveKey(row);
  const index = state.paidArchive.findIndex((item) => item && item.key === key);
  if (index < 0) return false;
  state.paidArchive.splice(index, 1);
  return true;
}
/* Report replacement-এর incoming rows-এর matching archive keys reconcile করি।
   পুরোনো rows আগে archive করা হয়েছে; অন্য মাসের records স্পর্শ করি না, কিন্তু
   একই installment correction-এ stale paid archive রেখে দিই না। */
function reconcilePaidArchiveBeforeReportReplace() {
  if (!Array.isArray(state.paidArchive) || !state.rows.length || state.detect.actual < 0) return false;
  let changed = false;
  for (const row of state.rows) {
    const key = paidArchiveKey(row);
    const index = state.paidArchive.findIndex((item) => item && item.key === key);
    const actual = num(row[state.detect.actual]);
    const amount = state.detect.amount >= 0 ? num(row[state.detect.amount]) : 0;
    const paid = actual > 0 && (state.detect.amount < 0 || amount <= 0 || actual >= amount);
    if (!paid) {
      if (index >= 0) { state.paidArchive.splice(index, 1); changed = true; }
      continue;
    }
    const previous = index >= 0 ? state.paidArchive[index] : null;
    const record = paidArchiveRecord(row, previous);
    if (index < 0) { state.paidArchive.push(record); changed = true; }
    else if (JSON.stringify(previous) !== JSON.stringify(record)) { state.paidArchive[index] = record; changed = true; }
  }
  return changed;
}

function dailyDataSnapshot() {
  return {
    memberDBHeaders: state.memberDBHeaders,
    memberDB: state.memberDB,
    balanceHeaders: state.balanceHeaders,
    balanceRows: state.balanceRows,
    todayRows: state.todayRows,
    paidArchive: state.paidArchive,
    staffDirectory: state.staffDirectory,
  };
}
function applyDailyData(data) {
  state.memberDBHeaders = Array.isArray(data?.memberDBHeaders) ? data.memberDBHeaders : [];
  state.memberDB = Array.isArray(data?.memberDB) ? data.memberDB : [];
  state.balanceHeaders = Array.isArray(data?.balanceHeaders) ? data.balanceHeaders : [];
  state.balanceRows = Array.isArray(data?.balanceRows) ? data.balanceRows : [];
  state.todayRows = Array.isArray(data?.todayRows) ? data.todayRows : [];
  /* পুরোনো shared document-এ paidArchive/staffDirectory না থাকলে browser-এর migration copy রক্ষিত থাকে। */
  if (Array.isArray(data?.paidArchive)) state.paidArchive = data.paidArchive;
  if (Array.isArray(data?.staffDirectory)) state.staffDirectory = [...(state.staffDirectory || []), ...data.staffDirectory];
}
function cacheDailyDataLocally() {
  try { localStorage.setItem(MEMBER_DB_KEY, JSON.stringify({ headers:state.memberDBHeaders, rows:state.memberDB })); } catch {}
  try { localStorage.setItem(BALANCE_DB_KEY, JSON.stringify({ headers:state.balanceHeaders, rows:state.balanceRows })); } catch {}
  try { localStorage.setItem(TODAY_ROWS_KEY, JSON.stringify(state.todayRows)); } catch {}
  try { localStorage.setItem(PAID_ARCHIVE_KEY, JSON.stringify(state.paidArchive)); } catch {}
  try { localStorage.setItem(STAFF_DB_KEY, JSON.stringify(state.staffDirectory)); } catch {}
}

/* ---------------- দ্রুত ওপেন · খসড়া · লোকাল ক্যাশ ---------------- */
const FULL_DOC_KEY = 'collectionManager.fullDoc.v1';
const DRAFT_KEY = 'collectionManager.todayDraft.v1';
const UI_STATE_KEY = 'collectionManager.uiState.v1';
const META_POLL_SEC = 10;

function buildDocument() {
  learnStaffDirectory();
  ensureEntryIds();
  return {
    updated_at: new Date().toISOString(),
    headers: state.headers,
    rows: state.rows,
    collections: state.collections,
    followups: state.followups,
    dailyData: dailyDataSnapshot(),
    history: state.history,
  };
}
/* পুরো ডাটা ব্রাউজারে রাখি — পরের বার অ্যাপ খুললে সাথে সাথে দেখাবে, নেটওয়ার্কের অপেক্ষা নেই */
function saveFullDocCache(doc) {
  try { localStorage.setItem(FULL_DOC_KEY, JSON.stringify(doc)); } catch { /* কোটা শেষ হলে চুপচাপ */ }
}
function readFullDocCache() {
  try {
    const doc = JSON.parse(localStorage.getItem(FULL_DOC_KEY) || 'null');
    return doc && Array.isArray(doc.rows) ? doc : null;
  } catch { return null; }
}

/* Device backup: current state-এ pending entries-ও থাকে। Outbox-এর patch রাখা
   হয় recovery audit-এর জন্য; restore-এ document ও patch আলাদাভাবে যাচাই করতে হবে।
   settings, identity, API key বা DATABASE_URL কখনো backup-এ যায় না। */
function createBackupPayload() {
  const document = buildDocument();
  const hasData = document.rows.length || document.dailyData.memberDB.length
    || document.dailyData.todayRows.length || document.dailyData.balanceRows.length;
  if (!hasData && !state.outbox.length) throw new Error('এই ডিভাইসে backup করার মতো data নেই।');
  return {
    format: 'collection-manager-backup',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VER,
    serverUpdatedAt: state.serverUpdatedAt || null,
    pendingOperationCount: state.outbox.length,
    document,
    pendingOperations: state.outbox.map((job) => ({ id: job.id, queuedAt: job.queuedAt, patch: job.patch })),
  };
}

function downloadLocalBackup() {
  const status = $('#backup-status');
  try {
    const backup = createBackupPayload();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `COLLECTION-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    const daily = backup.document.dailyData;
    const message = `✅ Backup download হচ্ছে · ${fmt(backup.document.rows.length)} কিস্তি · ${fmt(daily.todayRows.length)} Today · ${fmt(backup.pendingOperationCount)} pending`;
    if (status) status.textContent = message;
    toast(message);
  } catch (error) {
    if (status) status.textContent = '⚠️ ' + error.message;
    toast('⚠️ Backup তৈরি করা যায়নি: ' + error.message, true);
  }
}

/* অর্ধেক-টাইপ করা এন্ট্রি localStorage-এ থাকে — কল/অ্যাপ বন্ধ হলেও হারায় না */
let draftTimer = null;
function saveTodayDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const val = (id) => ($('#' + id)?.value ?? '');
    const blank = (v) => !String(v).trim() || /^0+(\.0+)?$/.test(String(v).trim());
    const empty = ['today-member-code', 'today-center-code', 'today-member-name', 'today-loan', 'today-savings', 'today-dps', 'today-total']
      .every((id) => blank(val(id)));
    try {
      if (empty && !(state.editingToday >= 0) && !state.editingTodayId) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        memberCode: val('today-member-code'), centerCode: val('today-center-code'),
        memberName: val('today-member-name'), loan: val('today-loan'),
        savings: val('today-savings'), dps: val('today-dps'), total: val('today-total'),
        autoField: TODAY_AMOUNT_KEYS.find((key) => todayAmountInput(key)?.dataset.autoCalc === '1') || '',
        editingToday: state.editingToday, editingTodayId: state.editingTodayId, rawMember: state.todayRawMember,
        rawCenter: state.todayRawCenter, savedAt: Date.now(),
      }));
    } catch { /* উপেক্ষা */ }
  }, 200);
}
function clearTodayDraft() {
  clearTimeout(draftTimer);
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* উপেক্ষা */ }
}
function restoreTodayDraft() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return false; }
  if (!draft) return false;
  if (Date.now() - Number(draft.savedAt || 0) > 24 * 3600 * 1000) { clearTodayDraft(); return false; }
  const set = (id, value) => { const el = $('#' + id); if (el && value != null) el.value = value; };
  resetTodayAmountAuto();
  set('today-member-code', draft.memberCode); set('today-center-code', draft.centerCode);
  set('today-member-name', draft.memberName); set('today-loan', draft.loan);
  set('today-savings', draft.savings); set('today-dps', draft.dps); set('today-total', draft.total);
  if (TODAY_AMOUNT_KEYS.includes(draft.autoField)) {
    const autoInput = todayAmountInput(draft.autoField);
    if (autoInput) { autoInput.dataset.autoCalc = '1'; autoInput.classList.add('auto-calculated'); }
  }
  state.todayRawMember = draft.rawMember || '';
  state.todayRawCenter = draft.rawCenter || '';
  const draftEditId = String(draft.editingTodayId || '');
  const restoredEditIndex = draftEditId
    ? state.todayRows.findIndex((item) => String(item?.id || '') === draftEditId)
    : (Number.isInteger(draft.editingToday) ? draft.editingToday : -1);
  if (restoredEditIndex >= 0 && state.todayRows[restoredEditIndex]) {
    state.editingToday = restoredEditIndex;
    state.editingTodayId = String(state.todayRows[restoredEditIndex].id || draftEditId || '');
    const btn = $('#btn-add-today');
    if (btn) { btn.textContent = '💾 এন্ট্রি আপডেট'; btn.classList.add('editing'); }
    const cancel = $('#btn-cancel-edit');
    if (cancel) cancel.classList.remove('hidden');
  }
  renderTodayBalanceCard();
  return true;
}

/* কোন পেজে ছিলেন, কোথায় স্ক্রল করে রেখেছিলেন */
function saveUiState() {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      page: state.activePage, scroll: Math.round(window.scrollY || 0), savedAt: Date.now(),
    }));
  } catch { /* উপেক্ষা */ }
}
function readUiState() {
  try { return JSON.parse(localStorage.getItem(UI_STATE_KEY) || 'null'); } catch { return null; }
}
function restoreUiState() {
  const ui = readUiState();
  if (!ui) return;
  /* App open-এ default সবসময় Today All Collection; শুধু scroll restore হয়। */
  if (Number.isFinite(ui.scroll) && ui.scroll > 0) {
    requestAnimationFrame(() => window.scrollTo(0, ui.scroll));
  }
}

/* ---------------- Neon-এ শেয়ারড ডাটা load/save ---------------- */
const loadDB = async (quiet = false) => {
  if (!state.isOnline) { updateSyncStatus(); return { ok: true, offline: true }; }
  if (state.outbox.length) {
    try { await flushOutbox(); }
    catch (error) { updateSyncStatus(); return { ok: true, offline: true, queued: true, error: error.message }; }
  }
  const document = await neonRead();
  let headers = [], rows = [];
  if (document && Array.isArray(document.headers) && Array.isArray(document.rows)) {
    headers = document.headers;
    rows = document.rows.filter((r) => Array.isArray(r));
  }
  const collections = document && Array.isArray(document.collections) ? document.collections : [];
  const followups = document && Array.isArray(document.followups) ? document.followups : [];
  const history = document && Array.isArray(document.history) ? document.history : [];
  const cloudDaily = document?.dailyData;
  const validCloudDaily = cloudDaily && Array.isArray(cloudDaily.memberDBHeaders)
    && Array.isArray(cloudDaily.memberDB) && Array.isArray(cloudDaily.balanceHeaders)
    && Array.isArray(cloudDaily.balanceRows) && Array.isArray(cloudDaily.todayRows);
  const migrateLocalDaily = canUpdateDatabase() && !validCloudDaily && Boolean(state.memberDB.length || state.balanceRows.length || state.todayRows.length || state.paidArchive.length);
  const oldDaily = JSON.stringify(dailyDataSnapshot());
  if (validCloudDaily) applyDailyData(cloudDaily);
  const changed = JSON.stringify(state.rows) !== JSON.stringify(rows)
    || JSON.stringify(state.collections) !== JSON.stringify(collections)
    || JSON.stringify(state.followups) !== JSON.stringify(followups)
    || JSON.stringify(state.history) !== JSON.stringify(history)
    || (validCloudDaily && oldDaily !== JSON.stringify(dailyDataSnapshot()));
  state.headers = headers;
  state.rows = rows;
  state.collections = collections;
  state.followups = followups;
  state.history = history;
  state.detect = detectColumns(headers);
  pruneMemberDBToActive();
  learnStaffDirectory();
  ensureEntryIds();
  if (state.editingTodayId) state.editingToday = resolveTodayEditIndex();
  state.lastSync = new Date();
  state.savedDoc = JSON.parse(JSON.stringify(buildDocument()));   // সার্ভারে এখন কী আছে — প্যাচ হিসাবের ভিত্তি
  /* পুরোনো Neon document-এ archive field নেই, কিন্তু local migration copy আছে—
     savedDoc-এও সেটি বসিয়ে দিলে প্রয়োজনীয় upsert বাদ পড়ে যেত। */
  if (validCloudDaily && !Array.isArray(cloudDaily?.paidArchive) && state.savedDoc.dailyData) {
    delete state.savedDoc.dailyData.paidArchive;
  }
  if (validCloudDaily && state.savedDoc.dailyData) {
    /* savedDoc-এ server-এর আসল staff list রাখি; learnStaffDirectory-এর নতুন নাম পরের patch-এ যাবে। */
    state.savedDoc.dailyData.staffDirectory = Array.isArray(cloudDaily?.staffDirectory) ? cloudDaily.staffDirectory : [];
  }
  state.serverUpdatedAt = document?.updated_at || state.serverUpdatedAt || null;
  saveFullDocCache(buildDocument());          // পরের বার খোলার সময় সাথে সাথে দেখানোর জন্য
  state.needsCanonicalSync = false;
  if (migrateLocalDaily) {
    try { await persistRows(); toast('✅ এই ব্রাউজারের সদস্য/আজকের ডাটা Neon-এ শেয়ার করা হয়েছে'); }
    catch (error) { toast('⚠️ এই ব্রাউজারের ডাটা Neon-এ সিঙ্ক হয়নি: '+error.message,true); }
  }
  /* পুরোনো double-tap-এর unapplied ‘অন্যান্য’ copy থাকলে নিরাপদে সরাই;
     appliedLoan>0 বা ভিন্ন অঙ্কের কোনো entry এখানে মুছে যায় না। */
  const cleanedDuplicates = canCollect() ? cleanupUnappliedTodayDuplicates() : 0;
  if (cleanedDuplicates) {
    try { await persistRows({ background: true }); }
    catch (error) { toast('⚠️ ডাবল এন্ট্রি পরিষ্কার করে sync করা যায়নি: '+error.message, true); }
  }
  if ((changed || cleanedDuplicates) && quiet) {
    renderAll();
    toast(cleanedDuplicates ? `🧹 ${fmt(cleanedDuplicates)}টি ডাবল ‘অন্যান্য আদায়’ copy সরানো হয়েছে · Neon sync চলছে` : '🔄 ডাটা আপডেট হয়েছে');
  }
};

/* আগের সেভের সাথে তুলনা — শুধু বদলানো অংশ বের করি */
function buildPatch(doc) {
  const prev = state.savedDoc;
  if (!prev || !Array.isArray(prev.rows) || !Array.isArray(doc.rows)) return null;
  const patch = {};
  if (JSON.stringify(prev.headers) !== JSON.stringify(doc.headers)) patch.headers = doc.headers;
  if (prev.rows.length !== doc.rows.length) {
    patch.rows = doc.rows;
  } else {
    const updates = [];
    let tooMany = false;
    for (let i = 0; i < doc.rows.length; i++) {
      if (prev.rows[i] === doc.rows[i]) continue;
      if (JSON.stringify(prev.rows[i]) !== JSON.stringify(doc.rows[i])) {
        updates.push([i, doc.rows[i]]);
        if (updates.length > 400) { tooMany = true; break; }
      }
    }
    if (tooMany) patch.rows = doc.rows;
    else if (updates.length) patch.rowUpdates = updates;
  }
  if (JSON.stringify(prev.collections) !== JSON.stringify(doc.collections)) patch.collections = doc.collections;
  if (JSON.stringify(prev.followups) !== JSON.stringify(doc.followups)) patch.followups = doc.followups;
  const prevDaily = prev.dailyData || {};
  const daily = doc.dailyData || {};
  const diffEntries = (before, after, upsertKey, removeKey) => {
    const previousById = new Map((Array.isArray(before) ? before : []).filter((item) => item?.id).map((item) => [String(item.id), item]));
    const nextIds = new Set((Array.isArray(after) ? after : []).map((item) => String(item?.id || '')).filter(Boolean));
    const upserts = (Array.isArray(after) ? after : []).filter((item) => item?.id && JSON.stringify(previousById.get(String(item.id))) !== JSON.stringify(item));
    const removes = (Array.isArray(before) ? before : []).filter((item) => item?.id && !nextIds.has(String(item.id))).map((item) => String(item.id));
    if (upserts.length) patch[upsertKey] = upserts;
    if (removes.length) patch[removeKey] = removes;
  };
  diffEntries(prevDaily.todayRows, daily.todayRows, 'todayUpserts', 'todayRemoveIds');
  diffEntries(prev.history, doc.history, 'historyUpserts', 'historyRemoveIds');
  const prevPaidArchive = Array.isArray(prevDaily.paidArchive) ? prevDaily.paidArchive : [];
  const nextPaidArchive = Array.isArray(daily.paidArchive) ? daily.paidArchive : [];
  if (JSON.stringify(prevPaidArchive) !== JSON.stringify(nextPaidArchive)) {
    const previousByKey = new Map(prevPaidArchive.filter((item) => item?.key).map((item) => [item.key, item]));
    const nextKeys = new Set(nextPaidArchive.map((item) => item?.key).filter(Boolean));
    const upserts = nextPaidArchive.filter((item) => item?.key && JSON.stringify(previousByKey.get(item.key)) !== JSON.stringify(item));
    const removeKeys = prevPaidArchive.filter((item) => item?.key && !nextKeys.has(item.key)).map((item) => item.key);
    if (upserts.length) patch.paidArchiveUpserts = upserts;
    if (removeKeys.length) patch.paidArchiveRemoveKeys = removeKeys;
  }
  if (JSON.stringify(prevDaily.staffDirectory || []) !== JSON.stringify(daily.staffDirectory || [])) {
    patch.staffDirectory = daily.staffDirectory || [];
  }
  if (JSON.stringify(prevDaily.memberDB) !== JSON.stringify(daily.memberDB)
      || JSON.stringify(prevDaily.memberDBHeaders) !== JSON.stringify(daily.memberDBHeaders)) {
    patch.memberDB = { headers: daily.memberDBHeaders, rows: daily.memberDB };
  }
  if (JSON.stringify(prevDaily.balanceRows) !== JSON.stringify(daily.balanceRows)
      || JSON.stringify(prevDaily.balanceHeaders) !== JSON.stringify(daily.balanceHeaders)) {
    patch.balance = { headers: daily.balanceHeaders, rows: daily.balanceRows };
  }
  return Object.keys(patch).length ? patch : null;
}

const persistRows = async (options = {}) => {
  const allowOffline = options.allowOffline !== false;
  const background = allowOffline && options.background === true;
  const document = buildDocument();
  /* নেটওয়ার্কের আগেই লোকাল — ট্যাব বন্ধ হলেও কিছু হারাবে না */
  cacheDailyDataLocally();
  saveFullDocCache(document);
  const patch = buildPatch(document);
  const hasInitialDocument = Boolean(state.savedDoc && Array.isArray(state.savedDoc.rows));
  markSaving(true);
  try {
    if (background) {
      const queued = Boolean(patch || !hasInitialDocument);
      if (queued) queueOperation(patch, patch ? null : document);
      state.savedDoc = JSON.parse(JSON.stringify(document));
      state.needsCanonicalSync = true;
      updateSyncStatus();
      if (state.isOnline && queued) scheduleBackgroundFlush();
      return { ok: true, background: true, queued, offline: !state.isOnline };
    }
    if (!state.isOnline) {
      if (!allowOffline) throw new Error('Database upload/update করতে internet চালু করুন।');
      if (patch || !hasInitialDocument) queueOperation(patch, patch ? null : document);
      state.savedDoc = JSON.parse(JSON.stringify(document));
      state.needsCanonicalSync = true;
      updateSyncStatus();
      return { ok: true, offline: true, queued: Boolean(patch || !hasInitialDocument) };
    }
    await flushOutbox();
    let result = null;
    if (patch || !hasInitialDocument) {
      result = patch ? await neonPatch(patch) : null;
      if (!result) result = await neonWrite(document);
    } else {
      result = { ok: true, unchanged: true, updated_at: state.serverUpdatedAt };
    }
    state.savedDoc = JSON.parse(JSON.stringify(document));
    state.serverUpdatedAt = result?.updated_at || state.serverUpdatedAt || new Date().toISOString();
    state.lastSync = new Date();
    state.needsCanonicalSync = true;
    updateSyncStatus();
    return result;
  } catch (error) {
    /* Validation/permission errors ফেরত দিই; network/server error হলে operation টি queue-তে রাখি। */
    if (!allowOffline) throw error;
    if (error?.status >= 400 && error?.status < 500 && error?.status !== 409) throw error;
    if (patch || !hasInitialDocument) queueOperation(patch, patch ? null : document);
    state.savedDoc = JSON.parse(JSON.stringify(document));
    state.needsCanonicalSync = true;
    updateSyncStatus();
    return { ok: true, offline: true, queued: true, error: error.message };
  } finally {
    markSaving(false);
  }
};

/* ---------------- ফিল্টার ---------------- */
function updateInstallmentSearchMode(clearValue = true) {
  const selector = $('#f-search-key'), input = $('#f-member');
  if (!selector || !input) return;
  const mode = selector.value;
  const dateMode = mode === 'promiseDate';
  // মেম্বার কোড ও সেন্টার কোড = শুধু সংখ্যা → মোবাইলে numeric কীবোর্ড; নাম = সাধারণ কীবোর্ড
  const numericMode = mode === 'memberCode' || mode === 'centerCode';
  if (clearValue) input.value = '';
  input.type = dateMode ? 'date' : 'search';
  if (dateMode) {
    input.removeAttribute('inputmode');
    input.removeAttribute('enterkeyhint');
  } else if (numericMode) {
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('enterkeyhint', 'done');
  } else {
    input.setAttribute('inputmode', 'text');
    input.setAttribute('enterkeyhint', 'search');
  }
  input.placeholder = dateMode
    ? ''
    : mode === 'memberCode' ? 'মেম্বার কোড লিখুন…'
    : mode === 'centerCode' ? 'সেন্টার কোড লিখুন…'
    : 'মেম্বার নাম লিখুন…';
  input.setAttribute('aria-label', dateMode ? 'প্রতিশ্রুতির তারিখ দিয়ে খুঁজুন' : numericMode ? 'কোড লিখে খুঁজুন' : 'সদস্যের নাম লিখে খুঁজুন');
  state.filters.searchBy = mode;
  state.filters.member = input.value.trim();
}
function filteredRows() {
  const f = state.filters, d = state.detect;
  const staffIdx = d.staffName >= 0 ? d.staffName : d.staff;
  const staffFilter = selectedStaffName() || f.staff;
  return state.rows.filter((r) => {
    if (!rowBelongsToSelectedStaff(r)) return false;
    if (staffFilter && staffIdx >= 0 && norm(r[staffIdx]) !== norm(staffFilter)) return false;
    if (f.center && d.centerCode >= 0 && norm(r[d.centerCode]) !== norm(f.center)) return false;
    if (f.member) {
      if (f.searchBy === 'promiseDate') {
        const followup = getFollowup(r);
        if (!followup?.promise?.trim()) return false;
        const promised = String(followup.nextDate || '');
        const given = followupGivenDate(followup);
        if (promised !== f.member && given !== f.member) return false;
      } else {
        const q = norm(f.member);
        const idx = f.searchBy === 'centerCode'
          ? (d.centerCode >= 0 ? d.centerCode : d.centerName)
          : f.searchBy === 'memberName' ? d.memberName : d.memberCode;
        if (idx < 0) return false;
        const raw = norm(r[idx]);
        const shown = f.searchBy === 'centerCode' ? norm(displayCenterCode(r[idx])) : f.searchBy === 'memberCode' ? norm(displayMemberCode(r[idx])) : raw;
        if (!raw.includes(q) && !shown.includes(q)) return false;
      }
    }
    if (f.date && d.date >= 0) {
      const cell = String(r[d.date] ?? '');
      if (toISODate(cell) !== f.date && cell.trim() !== f.date) return false;
    }
    if (f.followup || f.followupDate) {
      const followup = getFollowup(r);
      if (!followup) return false;
      if (f.followup && !norm(followup.promise).includes(norm(f.followup))) return false;
      if (f.followupDate && String(followup.nextDate || '') !== f.followupDate) return false;
    }
    return true;
  });
}

/* ---------------- রেন্ডার ---------------- */
function tableColumns() {
  const d = state.detect, cols = [], used = new Set();
  const add = (idx, label) => {
    if (idx >= 0 && !used.has(idx)) { cols.push({ idx, label }); used.add(idx); }
  };
  add(d.memberCode, 'মেম্বার কোড');
  add(d.memberName, 'মেম্বার নাম');
  add(d.centerCode, 'সেন্টার কোড');
  add(d.centerName, 'সেন্টার নাম');
  if (d.staffName >= 0) add(d.staffName, 'ষ্টাফ নাম');
  else add(d.staff, 'ষ্টাফ');
  add(d.date, 'তারিখ');
  add(d.amount, 'কিস্তি (৳)');
  add(d.actual, 'আদায় (৳)');
  cols.push({ idx: -1, label: 'বাকী (৳)', virtual: 'bal' });
  return cols; // শুধু দরকারি কলাম — বাকি অতিরিক্ত কলাম দেখানো হয় না
}

const RENDER_CAP = 500;

function cellHTML(r, c) {
  const d = state.detect;
  if (c.virtual === 'bal') {
    const amt = d.amount >= 0 ? num(r[d.amount]) : 0;
    const act = num(r[d.actual]);
    return `<td class="amt">${fmtMoney(Math.max(0, amt - act))}</td>`;
  }
  const v = r[c.idx] ?? '';
  if (c.idx === d.memberCode) return `<td>${esc(displayMemberCode(v))}</td>`;
  if (c.idx === d.centerCode) return `<td>${esc(displayCenterCode(v))}</td>`;
  if (c.idx === d.date) return `<td class="date-cell">${esc(shortDate(v))}</td>`;
  if (c.idx === d.amount || c.idx === d.actual) return `<td class="amt">${fmtMoney(num(v))}</td>`;
  return `<td>${esc(v)}</td>`;
}

function followupKey(row) {
  const d=state.detect;
  const code=d.memberCode>=0?String(row[d.memberCode]??'').trim():'';
  if(code) return `code:${normalizedDigits(code).replace(/^0+/,'')||norm(code)}`;
  const name=d.memberName>=0?norm(row[d.memberName]):'';
  const center=d.centerCode>=0?norm(row[d.centerCode]):'';
  return `member:${center}:${name}`;
}
function getFollowup(row) { const key=followupKey(row); return state.followups.find(item=>item.key===key) || null; }
function followupGivenDate(item) {
  if (item?.givenDate) return String(item.givenDate).slice(0,10);
  if (!item?.updatedAt) return '';
  const date = new Date(item.updatedAt);
  if (Number.isNaN(date.getTime())) return String(item.updatedAt).slice(0,10);
  const pad = (value) => String(value).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}
let followupRowIndex=null;
function openFollowupModal(rowIndex) {
  const row=state.rows[rowIndex]; if(!row) return;
  if (!canCollect() || !rowBelongsToSelectedStaff(row)) { toast('Manager শুধু পড়তে পারবেন; Staff শুধু নিজের সদস্যের প্রতিশ্রুতি বদলাতে পারবেন।', true); return; }
  followupRowIndex=rowIndex;
  const d=state.detect; const code=d.memberCode>=0?displayMemberCode(row[d.memberCode]):''; const name=d.memberName>=0?String(row[d.memberName]||''):'';
  $('#followup-member').textContent=[code,name].filter(Boolean).join(' · ')||`সারি ${fmt(rowIndex+1)}`;
  const existing=getFollowup(row);
  $('#followup-promise').value=existing?.promise||'';
  $('#followup-date').value=existing?.nextDate||'';
  $('#followup-error').classList.add('hidden');
  $('#followup-modal').classList.remove('hidden'); updateModalScrollLock();
}
async function saveFollowup() {
  const row=state.rows[followupRowIndex]; if(!row) return;
  if (!canCollect() || !rowBelongsToSelectedStaff(row)) { toast('এই প্রতিশ্রুতি বদলানোর অনুমতি নেই।', true); return; }
  const promise=$('#followup-promise').value.trim(); const nextDate=$('#followup-date').value;
  const key=followupKey(row); const old=[...state.followups];
  state.followups=state.followups.filter(item=>item.key!==key);
  if(promise||nextDate){
    const d=state.detect;
    state.followups.push({key,memberCode:d.memberCode>=0?String(row[d.memberCode]??''):'',memberName:d.memberName>=0?String(row[d.memberName]??''):'',promise,nextDate,givenDate:localDateInputValue(),updatedAt:new Date().toISOString()});
  }
  const button=$('#btn-save-followup'); button.disabled=true; button.textContent='⏳ সেভ হচ্ছে...';
  try {
    const saveResult = await persistRows({ background: true });
    $('#followup-modal').classList.add('hidden'); updateModalScrollLock(); followupRowIndex=null;
    renderAll(); toast(promise||nextDate
      ? `✅ প্রতিশ্রুতি সেভ হয়েছে${saveResult.background ? ' · Neon sync চলছে' : ''}`
      : `✅ প্রতিশ্রুতি/তারিখ মুছে দেওয়া হয়েছে${saveResult.background ? ' · Neon sync চলছে' : ''}`);
  } catch(e) {
    state.followups=old; $('#followup-error').textContent='⚠️ সেভ করা যায়নি: '+e.message; $('#followup-error').classList.remove('hidden'); renderAll();
  } finally { button.disabled=false; button.textContent='💾 সেভ করুন'; }
}

function renderSection(key, rows) {
  const cols = tableColumns();
  const d = state.detect;
  // কিস্তি তালিকা থেকে সরাসরি আদায় নেওয়া বন্ধ — আদায় হয় Today All Collection পেজ থেকে।
  const canCollect = false;
  const showFollowup = key !== 'paid' && effectiveRole() !== 'manager';
  const extraCols = (canCollect ? 1 : 0) + (showFollowup ? 1 : 0);
  const thead = $(`#table-${key} thead`);
  const tbody = $(`#tbl-${key}`);
  if (!thead || !tbody) return;

  thead.innerHTML = `<tr>${cols.map((c) => {
    const isAmt = c.virtual === 'bal' || c.idx === d.amount || c.idx === d.actual;
    return `<th class="${isAmt ? 'amt' : ''}">${esc(c.label)}</th>`;
  }).join('')}${canCollect ? '<th class="action-heading">আদায়</th>' : ''}${showFollowup ? '<th>প্রতিশ্রুতি / পরবর্তী তারিখ</th>' : ''}</tr>`;

  const shown = rows.slice(0, RENDER_CAP);
  tbody.innerHTML = shown.map((r) => {
    const cells = cols.map((c) => cellHTML(r, c)).join('');
    const rowIndex = state.rows.indexOf(r);
    const followup=getFollowup(r);
    // এই ঘরটি শুধু ইউজার নিজে হাতে লেখা প্রতিশ্রুতি / পরবর্তী তারিখ দেখায় — নিজে থেকে কোনো তারিখ বসানো হয় না
    const followupCell=showFollowup?`<td class="followup-cell">${followup?`<span class="followup-preview">${followup.promise?esc(followup.promise):''}${followup.nextDate?`<small>📅 ${esc(shortDate(followup.nextDate))}</small>`:''}</span>`:'<span class="followup-empty">—</span>'}<button class="followup-btn" type="button" data-followup-index="${rowIndex}" title="প্রতিশ্রুতি / পরবর্তী তারিখ লিখুন">📝 ${followup?'সম্পাদনা':'লিখুন'}</button></td>`:'';
    return `<tr class="clickable-row" data-row-index="${rowIndex}">${cells}${followupCell}</tr>`;
  }).join('')
    + (rows.length > RENDER_CAP
      ? `<tr><td colspan="${cols.length + extraCols}" style="text-align:center;color:var(--muted)">… আরও ${fmt(rows.length - RENDER_CAP)} সারি — ফিল্টার দিয়ে খুঁজুন</td></tr>`
      : '');

  $(`#count-${key}`).textContent = fmt(rows.length);
  $(`#empty-${key}`).classList.toggle('hidden', rows.length > 0);

  let sumAmt = 0, sumAct = 0, sumBal = 0;
  for (const r of rows) {
    const amt = d.amount >= 0 ? num(r[d.amount]) : 0;
    const act = num(r[d.actual]);
    sumAmt += amt; sumAct += act; sumBal += Math.max(0, amt - act);
  }
  $(`#sum-${key}`).innerHTML = `
    <div class="totals">
      <div class="total-box highlight"><span>মোট সংখ্যা</span><strong>${fmt(rows.length)}</strong></div>
      <div class="total-box"><span>মোট কিস্তি</span><strong>৳ ${fmtMoney(sumAmt)}</strong></div>
      <div class="total-box"><span>মোট আদায়</span><strong>৳ ${fmtMoney(sumAct)}</strong></div>
      <div class="total-box"><span>মোট বাকী</span><strong>৳ ${fmtMoney(sumBal)}</strong></div>
    </div>`;
}


const roundMoney = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(number * 100) / 100;
  return Number.isFinite(rounded) ? rounded : 0;
};

/* Today এন্ট্রির চারটি অঙ্কের ঘর: লোন + সঞ্চয় + DPS = মোট।
   যেকোনো তিনটি independent মান থাকলে চতুর্থটি বসে। auto-filled ঘরের আলাদা চিহ্ন থাকে,
   তাই উৎসের কোনো মান বদলালে সেটিই আবার হিসাব হয়—ব্যবহারকারীর হাতে লেখা মান নয়। */
const TODAY_AMOUNT_KEYS = ['loan', 'savings', 'dps', 'total'];
const TODAY_AMOUNT_LABELS = { loan: 'লোন', savings: 'সঞ্চয়', dps: 'DPS', total: 'মোট' };
const TODAY_AMOUNT_HINT = 'লোন, সঞ্চয়, DPS ও মোট—যেকোনো ৩টি ঘর পূরণ করলে বাকি ঘরটি অটো আসবে।';
const todayAmountInput = (key) => $('#today-' + key);
function setTodayAmountNote(message = TODAY_AMOUNT_HINT, isError = false) {
  const note = $('#today-amount-note');
  if (!note) return;
  note.textContent = message;
  note.classList.toggle('error', Boolean(isError));
}
function resetTodayAmountAuto() {
  TODAY_AMOUNT_KEYS.forEach((key) => {
    const input = todayAmountInput(key);
    if (!input) return;
    input.dataset.autoCalc = '0';
    input.classList.remove('auto-calculated');
  });
  setTodayAmountNote();
}
function autoCalculateTodayAmounts(changedKey = '') {
  const fields = Object.fromEntries(TODAY_AMOUNT_KEYS.map((key) => [key, todayAmountInput(key)]));
  if (TODAY_AMOUNT_KEYS.some((key) => !fields[key])) return '';
  const clearedAutoKey = changedKey && fields[changedKey]?.dataset.autoCalc === '1'
    && String(fields[changedKey].value || '').trim() === '' ? changedKey : '';
  if (changedKey && fields[changedKey]) {
    fields[changedKey].dataset.autoCalc = '0';
    fields[changedKey].classList.remove('auto-calculated');
  }
  const filled = (key) => String(fields[key].value || '').trim() !== '';
  let autoKey = TODAY_AMOUNT_KEYS.find((key) => fields[key].dataset.autoCalc === '1') || '';
  let target = '';

  // আগের auto-field-এর উৎস অন্য ঘরগুলো সম্পূর্ণ থাকলে সেটিই আবার হিসাব করি।
  if (autoKey && autoKey !== changedKey) {
    const sourcesReady = TODAY_AMOUNT_KEYS.filter((key) => key !== autoKey).every(filled);
    if (sourcesReady) target = autoKey;
    else {
      // উৎসের ঘর মুছে ফেললে পুরোনো auto মানটি আর রাখি না—স্টেল হিসাব থেকে যায় না।
      fields[autoKey].value = '';
      fields[autoKey].dataset.autoCalc = '0';
      fields[autoKey].classList.remove('auto-calculated');
      autoKey = '';
    }
  }
  if (!target) {
    // auto-filled ঘরটি নিজে মুছলে সঙ্গে সঙ্গে আবার না বসাই; পরের সম্পাদনায় হিসাব হবে।
    if (clearedAutoKey) { setTodayAmountNote(); return ''; }
    const blanks = TODAY_AMOUNT_KEYS.filter((key) => !filled(key));
    if (blanks.length === 1) target = blanks[0];
  }
  if (!target) { setTodayAmountNote(); return ''; }

  const sources = TODAY_AMOUNT_KEYS.filter((key) => key !== target);
  if (!sources.every(filled) || sources.some((key) => num(fields[key].value) < 0)) {
    setTodayAmountNote('⚠️ ঋণাত্মক অঙ্ক দিয়ে হিসাব করা যাবে না।', true);
    return '';
  }
  let value = target === 'total'
    ? roundMoney(num(fields.loan.value) + num(fields.savings.value) + num(fields.dps.value))
    : roundMoney(num(fields.total.value) - ['loan', 'savings', 'dps']
      .filter((key) => key !== target)
      .reduce((sum, key) => sum + num(fields[key].value), 0));
  if (value < 0) {
    fields[target].value = '';
    fields[target].dataset.autoCalc = '1';
    fields[target].classList.remove('auto-calculated');
    setTodayAmountNote(`⚠️ মোট অন্য ঘরগুলোর যোগফলের চেয়ে কম—${TODAY_AMOUNT_LABELS[target]} হিসাব করা যাচ্ছে না।`, true);
    return '';
  }
  if (Object.is(value, -0)) value = 0;
  TODAY_AMOUNT_KEYS.forEach((key) => {
    if (key !== target) fields[key].dataset.autoCalc = '0';
  });
  fields[target].value = String(value);
  fields[target].dataset.autoCalc = '1';
  fields[target].classList.add('auto-calculated');
  setTodayAmountNote();
  return target;
}
const localDateInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};



function safeTelephone(value) {
  let digits = toEn(String(value ?? '')).trim().replace(/(?!^\+)[^0-9]/g, '');
  if (/^[1-9]\d{9}$/.test(digits)) digits = '0' + digits;
  return digits;
}

function formatMemberDetails(entries, codeColumn = -1) {
  return (entries || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isNoiseColumn(item?.label))   // SLNo/OfficeID/ProductCode… অপ্রয়োজনীয় কলাম বাদ
    .flatMap(({ item, index }) => {
      const heading = normHeader(item.label || '');
      const looksLikeCode = heading.includes('member') && (heading.includes('no') || heading.includes('code') || heading.includes('id'));
      const isCenterCol = heading.includes('center') || heading.includes('centre') || heading.includes('samity')
        || String(item.label || '').toLowerCase().includes('সেন্টার');
      // "0001, GOBRA BAZAR" থেকে কোড ও নাম আলাদা দেখানো হয়।
      if (isCenterCol) {
        const parts = String(item.value ?? '').split(',').map((part) => part.trim());
        const codePart = parts.shift() || '';
        const namePart = parts.join(', ');
        const isCodeCol = heading.includes('code') || heading.includes('no') || heading.includes('id');
        if (isCodeCol) {
          const out = [{ ...item, value: displayCenterCode(codePart) }];
          if (namePart) out.push({ label: 'সেন্টারের নাম', value: namePart });
          return out;
        }
        // আলাদা "Center Name" কলামে কোড-নাম একসাথে থাকলে শুধু নামটুকু দেখানো হয়।
        if (namePart) return [{ ...item, value: namePart }];
        return [{ ...item, value: displayCenterCode(codePart) }];
      }
      const value = index === codeColumn || looksLikeCode ? displayMemberCode(item.value) : item.value;
      return [{ ...item, value }];
    });
}

/* ডিটেইলসে গুরুত্বপূর্ণ তথ্য (কোড, নাম, সেন্টার, পিতা/স্বামী/অভিভাবক, মোবাইল, কিস্তি) আগে,
   MIS/লোন-টেকনিক্যাল তথ্য পরে আলাদা হেডিং-এর নিচে দেখানো হয়। */
function detailPriority(label) {
  const n = normHeader(label || '');
  const raw = String(label || '').toLowerCase();
  // Today পেজের 'আজকের লোন/সঞ্চয়/DPS/মোট' ও সর্বশেষ স্থিতি — সবচেয়ে গুরুত্বপূর্ণ, তাই একদম উপরে
  if (raw.startsWith('আজকের') || raw.includes('স্থিতি')) return 0;
  if (n.includes('father') || n.includes('husband') || n.includes('careof') || n.includes('guardian')
    || raw.includes('পিতা') || raw.includes('স্বামী') || raw.includes('অভিভাবক')) return 3;
  if (n.includes('member') && (n.includes('no') || n.includes('code') || n.includes('id'))) return 0;
  if (n.includes('membername') || n === 'name' || raw.includes('সদস্যের নাম')) return 1;
  const isCenter = n.includes('center') || n.includes('centre') || n.includes('samity') || raw.includes('সেন্টার');
  if (isCenter) return (n.includes('code') || n.includes('no') || n.includes('id')) ? 2 : 3.5;
  if (n.includes('contact') || n.includes('mobile') || n.includes('phone') || raw.includes('মোবাইল')) return 4;
  if (n.includes('staff') || n.includes('officer') || n.includes('collector')
    || (n.includes('emp') && n.includes('name')) || (n.includes('employee') && n.includes('name'))) return 4.5;
  if (n.includes('installment') || n.includes('instalment') || n.includes('kisti') || raw.includes('কিস্তি')) return 5;
  if (n.includes('date') || raw.includes('তারিখ')) return 6;
  return 9;
}
function prioritizeDetails(entries) {
  const list = (entries || []).filter((item) => item && !item.divider);
  const hints = list.filter((item) => item.hint);
  const plain = list.filter((item) => !item.hint);
  if (plain.length < 2) return [...plain, ...hints];
  const sorted = plain
    .map((item, index) => ({ item, index, score: detailPriority(item.label) }))
    .sort((a, b) => (a.score - b.score) || (a.index - b.index))
    .map((entry) => entry.item);
  const mainCount = sorted.filter((item) => detailPriority(item.label) <= 6).length;
  if (!mainCount || mainCount === sorted.length) return [...sorted, ...hints];
  return [
    ...sorted.slice(0, mainCount),
    { divider: true, label: '📋 অন্যান্য তথ্য (লোন / MIS)' },
    ...sorted.slice(mainCount),
    ...hints,
  ];
}

function openMemberDetails(entries, mobile = '', title = 'সদস্যের তথ্য', collectionEntry = null) {
  activeBalanceCollection = collectionEntry;
  const phone = String(mobile ?? '').trim();
  const tel = safeTelephone(phone);
  $('#member-modal-title').textContent = title || 'সদস্যের তথ্য';
  $('#member-call-action').innerHTML = tel
    ? `<a class="call-button" href="tel:${esc(tel)}">📞 কল করুন <span>${esc(tel)}</span></a>`
    : '<span class="no-phone">📵 মোবাইল নম্বর পাওয়া যায়নি</span>';
  $('#member-collection-action').innerHTML = collectionEntry && canCollect()
    ? '<button class="btn primary" id="btn-collect-from-balance" type="button">💰 আদায়</button>'
    : '';
  const list = Array.isArray(entries) ? entries : [];
  const dividerAt = list.findIndex((item) => item && item.divider);
  const head = dividerAt >= 0 ? list.slice(0, dividerAt) : list;
  const tail = dividerAt >= 0 ? list.slice(dividerAt) : [];
  const organized = prioritizeDetails(head);
  // সদস্য ডাটাবেজের অংশ (পিতা/স্বামী/অভিভাবক) MIS-ব্লকের আগে বসে, যাতে গুরুত্বপূর্ণ তথ্য উপরেই থাকে।
  const misAt = organized.findIndex((item) => item && item.divider);
  const finalOrder = misAt >= 0
    ? [...organized.slice(0, misAt), ...tail, ...organized.slice(misAt)]
    : [...organized, ...tail];
  $('#member-detail-grid').innerHTML = finalOrder.map((item) => {
    if (!item) return '';
    if (item.divider) return `<div class="detail-divider">${esc(item.label || '')}</div>`;
    if (item.hint) return `<div class="detail-hint">${esc(item.label || '')}</div>`;
    if (!String(item.label || '').trim()) return '';   // শিরোনামহীন কলাম বাদ
    return `<div class="detail-item"><span>${esc(item.label)}</span><strong>${esc(item.value || '—')}</strong></div>`;
  }).join('') || '<div class="empty">কোনো সদস্য-তথ্য পাওয়া যায়নি।</div>';
  $('#member-details-modal').classList.remove('hidden');
  updateModalScrollLock();
}

/* কোড না মিললে নাম ও সেন্টার দিয়ে সদস্য ডাটাবেজের সারি খোঁজা (শুধু একটাই মিললে)। */
function findDirectoryByName(name, centerHint = '') {
  const ni = memberCol(state.memberDBHeaders, 'name');
  if (ni < 0 || !name) return null;
  const target = norm(name);
  if (!target) return null;
  let matches = state.memberDB.filter((row) => norm(row[ni]) === target);
  if (matches.length > 1 && centerHint) {
    const ci = memberCol(state.memberDBHeaders, 'center');
    const cd = normalizedDigits(String(centerHint).split(',')[0]).replace(/^0+/, '');
    const byCenter = matches.filter((row) => {
      const c = normalizedDigits(String(row[ci] || '').split(',')[0]).replace(/^0+/, '');
      return c === cd || (cd.length >= 3 && c.endsWith(cd));
    });
    if (byCenter.length) matches = byCenter;
  }
  return matches.length === 1 ? matches[0] : null;
}

/* সদস্য ডাটাবেজ (Today All Collection) থেকে ডিটেইলসে অতিরিক্ত তথ্য যোগ করা —
   পিতা/স্বামী/অভিভাবকসহ অন্যান্য কলাম, কিস্তি তালিকার সারিতে না থাকলেও দেখানো হয়। */
function detailKey(label) {
  const text = String(label ?? '').trim();
  return normHeader(text) || text.toLowerCase();
}
function mergeDirectoryDetails(entries, code, centerHint = '', nameHint = '') {
  const base = (Array.isArray(entries) ? entries : []).filter(Boolean).map((item) => ({ ...item }));
  const row = resolveDirectoryRow(code, centerHint) || findDirectoryByName(nameHint, centerHint);
  if (!row) {
    const hint = { hint: true, label: 'ℹ️ এই সদস্যের অভিভাবকের তথ্য active contact list-এ পাওয়া যায়নি—current balance/installment তথ্যই দেখানো হচ্ছে।' };
    return { entries: [...base, hint], mobile: '', matched: false };
  }
  const headers = state.memberDBHeaders || [];
  const codeIndex = memberCol(headers, 'code');
  const nameIndex = memberCol(headers, 'name');
  const mobileIndex = memberCol(headers, 'mobile');
  const centerIndex = memberCol(headers, 'center');
  const guardianIndex = memberCol(headers, 'guardian');
  const baseKeys = new Set(base.map((item) => detailKey(item.label)));
  const baseHas = (test) => base.some((item) => test(normHeader(item.label || ''), String(item.label || '').toLowerCase()));
  const hasGuardian = baseHas((n, raw) => n.includes('father') || n.includes('husband') || n.includes('careof') || n.includes('guardian')
    || raw.includes('পিতা') || raw.includes('স্বামী') || raw.includes('অভিভাবক') || raw.includes('care of'));
  const hasCenter = baseHas((n, raw) => n.includes('center') || n.includes('centre') || n.includes('samity')
    || raw.includes('সেন্টার') || raw.includes('কেন্দ্র'));
  const added = [];
  const seen = new Set();
  const push = (label, value) => {
    const key = detailKey(label);
    const text = String(value ?? '').trim();
    if (!label || !text || seen.has(key) || baseKeys.has(key)) return;
    seen.add(key);
    added.push({ label, value: text });
  };
  headers.forEach((header, index) => {
    const label = String(header || '').replace(/\s+/g, ' ').trim();
    const value = String(row[index] ?? '').trim();
    if (!label || !value) return;
    if (index === codeIndex || index === nameIndex || index === mobileIndex) return;
    if (index === centerIndex) return;
    if (index === guardianIndex) { if (!hasGuardian) push(label, value); return; }
    if (/^sl\.?\s*no\.?$/i.test(label) || normHeader(label) === 'slno') return;
    push(label, value);
  });
  if (!hasCenter && centerIndex >= 0) {
    const parts = String(row[centerIndex] || '').split(',').map((part) => part.trim());
    const centerCode = parts.shift() || '';
    const centerName = parts.join(', ');
    if (centerCode) push('সেন্টার কোড', displayCenterCode(centerCode));
    if (centerName) push('সেন্টারের নাম', centerName);
  }
  const mobile = mobileIndex >= 0 ? String(row[mobileIndex] ?? '').trim() : '';
  if (!added.length) return { entries: base, mobile, matched: true };
  return {
    entries: [...base, { divider: true, label: '🗃️ সদস্য ডাটাবেজ (Today All Collection) থেকে' }, ...formatMemberDetails(added, -1)],
    mobile,
    matched: true,
  };
}

function openMemberDetailsFromRow(rowIndex) {
  const row = state.rows[rowIndex];
  if (!row || !rowBelongsToSelectedStaff(row)) return;
  const d = state.detect;
  const entries = formatMemberDetails(state.headers.map((header, i) => ({ label: String(header), value: String(row[i] ?? '') })), d.memberCode);
  const rawCode = d.memberCode >= 0 ? String(row[d.memberCode] ?? '') : '';
  const center = d.centerCode >= 0 ? String(row[d.centerCode] ?? '') : '';
  const memberName = d.memberName >= 0 ? String(row[d.memberName] ?? '').trim() : '';
  const merged = mergeDirectoryDetails(entries, rawCode, center, memberName);
  const mobile = (d.mobile >= 0 ? String(row[d.mobile] ?? '').trim() : '') || merged.mobile;
  const code = d.memberCode >= 0 ? displayMemberCode(row[d.memberCode]) : '';
  const name = memberName;
  const sourcePage = SECTION_KEYS.includes(state.activePage) ? state.activePage : '';
  const collectionEntry = rawCode && ['today-promise', 'payable', 'due', 'partial'].includes(sourcePage)
    ? { kind: 'installment', rowIndex, installmentKey: installmentRowKey(row), code: rawCode, center, name: memberName, returnPage: sourcePage }
    : null;
  openMemberDetails(stripHiddenDetails(merged.entries), mobile, [code, name].filter(Boolean).join(' · ') || 'সদস্যের তথ্য', collectionEntry);
}


function installmentRowKey(row) {
  const d=state.detect;
  const signature=JSON.stringify(row.map((value,index)=>index===d.actual?'':String(value??'')));
  let hash=2166136261;
  for(let i=0;i<signature.length;i++){hash^=signature.charCodeAt(i);hash=Math.imul(hash,16777619);}
  const base=(hash>>>0).toString(36);
  const rowIndex=state.rows.indexOf(row);
  const duplicateRank=rowIndex<0?0:state.rows.slice(0,rowIndex).filter(candidate=>JSON.stringify(candidate.map((value,index)=>index===d.actual?'':String(value??'')))===signature).length;
  return `${base}:${duplicateRank}`;
}


function filteredPaidArchive() {
  const month = ($('#paid-archive-month')?.value || '').trim();
  const date = ($('#paid-archive-date')?.value || '').trim();
  const staff = String(selectedStaffName() || state.filters.staff || $('#f-staff')?.value || '').trim();
  return state.paidArchive.filter((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (staff && norm(item.staffName || staffForMemberCode(item.memberCode, item.centerCode)) !== norm(staff)) return false;
    const paidDate = toISODate(item.paidDate);
    if (date && paidDate !== date) return false;
    if (month && paidDate.slice(0, 7) !== month) return false;
    return true;
  });
}
function paidArchiveMonthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('bn-BD', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function renderPaidArchive() {
  const body = $('#paid-archive-list');
  if (!body) return;
  const archive = Array.isArray(state.paidArchive) ? state.paidArchive : [];
  const monthSelect = $('#paid-archive-month');
  const selectedMonth = monthSelect?.value || '';
  const visibleArchive = archive.filter((item) => !selectedStaffName() || norm(item?.staffName || staffForMemberCode(item?.memberCode, item?.centerCode)) === norm(selectedStaffName()));
  const months = [...new Set(visibleArchive.map((item) => toISODate(item?.paidDate).slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
  if (monthSelect) {
    monthSelect.innerHTML = '<option value="">সব মাস</option>' + months.map((month) => `<option value="${month}">${esc(paidArchiveMonthLabel(month))}</option>`).join('');
    monthSelect.value = months.includes(selectedMonth) ? selectedMonth : '';
  }
  const selectedDate = $('#paid-archive-date')?.value || '';
  const list = filteredPaidArchive().sort((a, b) => {
    const dateCompare = toISODate(b.paidDate).localeCompare(toISODate(a.paidDate));
    if (dateCompare) return dateCompare;
    const dueCompare = toISODate(b.installmentDate).localeCompare(toISODate(a.installmentDate));
    if (dueCompare) return dueCompare;
    return compareMemberCodes(a.memberCode, b.memberCode) || compareAZ(a.memberName, b.memberName);
  });
  const html = [];
  let group = null;
  let entries = [];
  const paintGroup = () => {
    if (!group || !entries.length) return;
    const amount = roundMoney(entries.reduce((sum, item) => sum + num(item.amount), 0));
    const actual = roundMoney(entries.reduce((sum, item) => sum + num(item.actual), 0));
    const dateLabel = group === 'unknown' ? 'তারিখ নেই' : shortDate(group);
    html.push(`<tr class="paid-archive-date-total" data-date-total="${esc(group)}"><td colspan="5">${esc(dateLabel)} · মোট ${fmt(entries.length)}টি কিস্তি</td><td class="amt">${fmtMoney(amount)}</td><td class="amt">${fmtMoney(actual)}</td></tr>`);
  };
  list.forEach((item) => {
    const paidDate = toISODate(item.paidDate);
    const nextGroup = paidDate || 'unknown';
    if (group !== null && nextGroup !== group) { paintGroup(); entries = []; }
    group = nextGroup;
    entries.push(item);
    html.push(`<tr class="paid-archive-row" data-paid-date="${esc(paidDate)}" data-paid-month="${esc(paidDate.slice(0, 7))}">
      <td>${paidDate ? esc(shortDate(paidDate)) : 'তারিখ নেই'}</td>
      <td>${item.installmentDate ? esc(shortDate(item.installmentDate)) : '—'}</td>
      <td>${esc(displayMemberCode(item.memberCode))}</td>
      <td>${esc(displayCenterCode(item.centerCode))}</td>
      <td>${esc(item.memberName || '—')}</td>
      <td class="amt">${fmtMoney(item.amount)}</td>
      <td class="amt">${fmtMoney(item.actual)}</td>
    </tr>`);
  });
  paintGroup();
  if (list.length) {
    const amount = roundMoney(list.reduce((sum, item) => sum + num(item.amount), 0));
    const actual = roundMoney(list.reduce((sum, item) => sum + num(item.actual), 0));
    html.push(`<tr class="paid-archive-grand-total"><td colspan="5">সর্বমোট ${fmt(list.length)}টি কিস্তি</td><td class="amt">${fmtMoney(amount)}</td><td class="amt">${fmtMoney(actual)}</td></tr>`);
  }
  body.innerHTML = html.join('');
  $('#count-paid-archive').textContent = fmt(list.length);
  const empty = $('#paid-archive-empty');
  empty.classList.toggle('hidden', list.length > 0);
  empty.textContent = archive.length ? 'এই ষ্টাফ/তারিখ/মাসে কোনো আদায় কিস্তি নেই।' : 'এখনো কোনো আদায় কিস্তি আর্কাইভ হয়নি।';
  $('.paid-archive-table-wrap')?.classList.toggle('hidden', list.length === 0);
  const filterLabel = $('#paid-archive-filter-label');
  if (filterLabel) {
    const scope = selectedDate ? shortDate(selectedDate) : monthSelect?.value ? paidArchiveMonthLabel(monthSelect.value) : 'সব তারিখ';
    const staff = String(state.filters.staff || '').trim();
    filterLabel.textContent = `${staff ? `${staff} · ` : ''}${scope} · ${fmt(list.length)}টি কিস্তি`;
  }
}

function renderTables() {
  const rows = sortRowsAZ(filteredRows());
  const groups = { due: [], paid: [], partial: [] };
  const today = localDateInputValue();
  for (const r of rows) groups[rowStatus(r)].push(r);
  // "আজ প্রতিশ্রুতি" = যেসব সদস্যের **প্রতিশ্রুতি / পরবর্তী তারিখ (ইউজার নিজে হাতে যা লিখেছেন) = আজ**।
  // শর্ত = প্রতিশ্রুতির তারিখ (কিস্তির তারিখ বা আদায়ের অবস্থা নয়) — যে সদস্য আজ আসার ওয়াদা দিয়েছেন, তিনিই এই তালিকায়।
  // "আজ আদায়যোগ্য" = আজ যে কিস্তি পড়েছে (কিস্তির তারিখ = আজ) অথচ টাকা এখনো পুরো আসেনি (বাকী + আংশিক)।
  const payable = rows.filter((row) => {
    const st = rowStatus(row);
    return (st === 'due' || st === 'partial') && rowDateISO(row) === today;
  });
  const todayPromises = rows.filter((row) => {
    const followup = getFollowup(row);
    return !!followup && String(followup.nextDate || '').slice(0, 10) === today;
  });

  renderSection('today-promise', todayPromises);   // আজ প্রতিশ্রুতি (সবার উপরে)
  renderSection('payable', payable);               // আজ আদায়যোগ্য (আজ প্রতিশ্রুতি ও বাকী কিস্তির মাঝে)
  renderSection('due', groups.due);
  renderSection('paid', groups.paid);
  renderSection('partial', groups.partial);
  renderPaidArchive();

  const todayLabel = shortDate(today);
  const dateBadge = $('#today-promise-date');
  if (dateBadge) dateBadge.textContent = `(${todayLabel})`;
  const emptyPromise = $('#empty-today-promise');
  if (emptyPromise) emptyPromise.textContent = `আজ (${todayLabel}) তারিখের জন্য কোনো প্রতিশ্রুতি লেখা নেই — কিস্তি তালিকার 📝 লিখুন থেকে লিখুন।`;

  $('#chip-due strong').textContent = fmt(groups.due.length);
  $('#chip-paid strong').textContent = fmt(groups.paid.length);
  $('#chip-partial strong').textContent = fmt(groups.partial.length);

  const hasData = state.rows.length > 0 || state.paidArchive.length > 0 || state.balanceRows.length > 0;
  $('#no-data').classList.toggle('hidden', hasData);
  $$('[data-sec]').forEach((el) => el.classList.toggle('hidden', !hasData));
  const balancePage = state.activePage === 'balance-directory';
  $('#summary-chips').classList.toggle('hidden', !hasData || balancePage);
  $('.advanced-filters')?.classList.toggle('hidden', balancePage);
  applySectionView();
}

// কোন তালিকা দেখাবেন (সব / আজ প্রতিশ্রুতি / বাকী / আদায় / আংশিক)
const SECTION_KEYS = ['today-promise', 'payable', 'due', 'paid', 'partial', 'balance-directory', 'paid-archive'];

/* সব তালিকা ডিফল্টে বন্ধ (collapsed) — মাথায় চাপ দিলে খোলে */
function collapseAllSections() {
  SECTION_KEYS.forEach((key) => {
    const el = $('#sec-' + key);
    if (el) el.classList.add('collapsed');
  });
}
function expandSection(key) {
  const el = $('#sec-' + key);
  if (el) el.classList.remove('collapsed');
}

function applySectionView() {
  const view = state.sectionView || 'all';
  const installmentData = state.rows.length > 0 || state.paidArchive.length > 0;
  SECTION_KEYS.forEach((key) => {
    const el = $('#sec-' + key);
    if (!el) return;
    const hasSectionData = key === 'balance-directory' ? state.balanceRows.length > 0 : installmentData;
    const show = hasSectionData && (view === 'all' || view === key);
    el.classList.toggle('hidden', !show);
    /* একক তালিকা বাছলে সেটা নিজে থেকেই খুলে যায় */
    if (show && view !== 'all') el.classList.remove('collapsed');
  });
}





const memberCol = (headers, kind) => {
  const hs = headers.map((h) => normHeader(h));
  const tests = {
    code: (h) => (h.includes('member') && (h.includes('no') || h.includes('code') || h.includes('number'))) || h === 'memno',
    center: (h) => h.includes('center') && (h.includes('code') || h.includes('name')),
    name: (h) => h.includes('membername') || h === 'name',
    mobile: (h) => h.includes('contactnumber') || h.includes('mobile') || h.includes('phone'),
    guardian: (h) => h.includes('father') || h.includes('husband') || h.includes('careof') || h.includes('guardian'),
    status: (h) => h.includes('status'),
  };
  return hs.findIndex(tests[kind] || (() => false));
};
function memberHeadersRow(rows) {
  return rows.findIndex((r) => {
    const n = r.map(normHeader);
    return n.some((x) => x.includes('member') && (x.includes('no') || x.includes('code')))
      && n.some((x) => x.includes('contact') || x.includes('mobile'));
  });
}
function findDirectoryMember(code, centerHint = '') {
  const idx = memberCol(state.memberDBHeaders, 'code');
  if (idx < 0 || !code) return null;
  const digits = normalizedDigits(code);
  const key = digits.replace(/^0+/, '');
  const exact = state.memberDB.find((row) => normalizedDigits(row[idx]).replace(/^0+/, '') === key);
  if (exact) return exact;
  // Balance CSV-র ছোট Member ID-ও full directory Member No-র শেষাংশ হতে পারে।
  if (digits.length < 3) return null;
  let candidates = state.memberDB.filter((row) => normalizedDigits(row[idx]).endsWith(digits));
  const typedCenter = normalizedDigits(centerHint || state.todayRawCenter || $('#today-center-code')?.value || '');
  if (typedCenter && candidates.length > 1) {
    const centerIndex = memberCol(state.memberDBHeaders, 'center');
    const byCenter = candidates.filter((row) => {
      const center = normalizedDigits(String(row[centerIndex] || '').split(',')[0]);
      return center === typedCenter || (typedCenter.length >= 3 && center.endsWith(typedCenter));
    });
    if (byCenter.length) candidates = byCenter;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

// UI-তে দেখানো শেষ ৪ সংখ্যা দিয়ে সদস্য খোঁজা হলে মূল কোডসহ ডিরেক্টরি সারি বের করা।
function resolveDirectoryRow(typed, centerHint = '') {
  const idx = memberCol(state.memberDBHeaders, 'code');
  if (idx < 0 || !typed) return null;
  const digits = normalizedDigits(typed);
  const pickByCenter = (matches) => {
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const typedCenter = normalizedDigits(centerHint || state.todayRawCenter || $('#today-center-code')?.value || '');
      if (typedCenter) {
        const centerIndex = memberCol(state.memberDBHeaders, 'center');
        const byCenter = matches.filter((row) => {
          const center = normalizedDigits(String(row[centerIndex] || '').split(',')[0]);
          return center === typedCenter || (typedCenter.length >= 3 && center.endsWith(typedCenter));
        });
        if (byCenter.length === 1) return byCenter[0];
      }
    }
    return null;
  };
  // ছোট (৪ সংখ্যা) কোড লিখলে প্রথমে UI-তে দেখানো শেষ ৪ সংখ্যার সাথে মেলানো।
  if (digits.length <= 4) {
    const short = toEn(String(typed)).trim();
    const matches = state.memberDB.filter((row) => displayMemberCode(row[idx]) === short);
    const hit = pickByCenter(matches);
    if (hit) return hit;
  }
  return findDirectoryMember(typed, centerHint);
}

/* Balance-এ nonzero স্থিতি + current installment list-এর সদস্যদের contact রাখি।
   Load/cache-এ savedDoc-ও compact রাখি যাতে কোনো staff save-এর সাথে নিজে থেকে
   Neon patch না যায়; admin upload/migration-এ markForSync:true দিলে patch-এ যাবে। */
function pruneMemberDBToActive({ markForSync = false } = {}) {
  const rules = window.COLLECTION_ACTIVE_MEMBERS;
  if (!rules) return null;
  const result = rules.compactActiveMembers({
    memberDBHeaders: state.memberDBHeaders,
    memberDB: state.memberDB,
    balanceHeaders: state.balanceHeaders,
    balanceRows: state.balanceRows,
    installmentHeaders: state.headers,
    installmentRows: state.rows,
  });
  if (result.skipped) return result.stats;
  state.memberDBHeaders = result.headers;
  state.memberDB = result.rows;
  if (!markForSync && state.savedDoc?.dailyData) {
    state.savedDoc.dailyData.memberDBHeaders = result.headers;
    state.savedDoc.dailyData.memberDB = result.rows;
  }
  try { localStorage.setItem(MEMBER_DB_KEY, JSON.stringify({ headers: result.headers, rows: result.rows })); } catch {}
  state.lastMemberPrune = result.stats;
  return result.stats;
}

function dailyAccountKey(item) {
  const directoryRow = resolveDirectoryRow(item.memberCode, item.centerCode);
  const codeIndex = memberCol(state.memberDBHeaders, 'code');
  const rawCode = directoryRow && codeIndex >= 0 ? directoryRow[codeIndex] : item.memberCode;
  const digits = normalizedDigits(rawCode);
  return digits ? `id:${digits.replace(/^0+/,'')}` : `name:${norm(item.memberName)}:${norm(item.centerCode)}`;
}
function fillTodayMember() {
  state.todayInstallmentKey = '';
  const code = $('#today-member-code').value.trim();
  const row = resolveDirectoryRow(code);
  if (row && !directoryRowVisible(row)) {
    state.todayRawCenter = ''; state.todayRawMember = '';
    $('#today-member-name').value = '';
    updateTodayEntryNote(); renderToday();
    toast('এই সদস্য নির্বাচিত Staff-এর তালিকায় নেই।', true);
    return;
  }
  if (!row) { state.todayRawCenter = ''; state.todayRawMember = ''; updateTodayEntryNote(); renderToday(); return; }
  const ci = memberCol(state.memberDBHeaders, 'center'), ni = memberCol(state.memberDBHeaders, 'name');
  if (ci >= 0) {
    const rawCenter = String(row[ci] || '').split(',')[0].trim();
    state.todayRawCenter = rawCenter;
    $('#today-center-code').value = displayCenterCode(rawCenter);
  }
  if (ni >= 0) $('#today-member-name').value = String(row[ni] || '').trim();
  const codeIndex = memberCol(state.memberDBHeaders, 'code');
  if (codeIndex >= 0) {
    state.todayRawMember = String(row[codeIndex] || '').trim();
    $('#today-member-code').value = displayMemberCode(row[codeIndex]);
  }
  autofillTodayLoan(state.todayRawMember || code);
  updateTodayEntryNote();
  renderToday();
}
/* Details → আদায় থেকে আসলে clicked row-টিই target হয়; member বদলালে target বাতিল। */
function targetedTodayInstallmentRow(code, centerCode = '') {
  if (!state.todayInstallmentKey || !code) return -1;
  const rowIndex = findRowByInstallmentKey(state.todayInstallmentKey);
  if (rowIndex < 0) return -1;
  const d = state.detect, row = state.rows[rowIndex];
  if (d.memberCode < 0 || memberCodeKey(row[d.memberCode]) !== memberCodeKey(code)) return -1;
  if (centerCode && d.centerCode >= 0) {
    const expected = memberCodeKey(centerCode), actual = memberCodeKey(row[d.centerCode]);
    if (expected && actual !== expected && !(expected.length <= 3 && actual.endsWith(expected))) return -1;
  }
  return rowIndex;
}
/* কিস্তি তালিকায় সদস্য থাকলে ওঁর আজকের/সামনের কিস্তির বাকী অঙ্কটাই লোন ঘরে বসে যায় */
function autofillTodayLoan(code) {
  const loanInput = $('#today-loan');
  if (!loanInput) return;
  const targetedIndex = targetedTodayInstallmentRow(code, state.todayRawCenter || $('#today-center-code')?.value || '');
  const rowIndex = targetedIndex >= 0 ? targetedIndex : findInstallmentRowForMember(code);
  const d = state.detect;
  const bal = rowIndex >= 0 && d.amount >= 0
    ? Math.max(0, roundMoney(num(state.rows[rowIndex][d.amount]) - num(state.rows[rowIndex][d.actual])))
    : 0;
  if (!loanInput.value || loanInput.dataset.autofill === '1') {
    if (bal > 0) {
      loanInput.value = String(bal); loanInput.dataset.autofill = '1';
      loanInput.dataset.autoCalc = '0'; loanInput.classList.remove('auto-calculated');
    } else if (loanInput.dataset.autofill === '1') {
      loanInput.value = ''; loanInput.dataset.autofill = '0';
      loanInput.dataset.autoCalc = '0'; loanInput.classList.remove('auto-calculated');
    }
  }
  autoCalculateTodayAmounts();
  renderTodayBalanceCard();
}
/* ফর্মের নিচে ছোট নোট — এই সদস্য মাসিক নাকি অন্যান্য */
function updateTodayEntryNote() {
  const el = $('#today-entry-note');
  if (!el) return;
  const typed = ($('#today-member-code')?.value || '').trim();
  const code = state.todayRawMember || typed;
  if (!code) { el.textContent = ''; el.className = 'today-entry-note'; return; }
  const centerCode = state.todayRawCenter || $('#today-center-code')?.value || '';
  const memberName = $('#today-member-name')?.value || '';
  const rowIndex = findInstallmentRowForEntry({ memberCode: code, centerCode, memberName });
  if (rowIndex < 0) {
    el.className = 'today-entry-note other';
    el.textContent = installmentNameRowIndexes(memberName, centerCode).length
      ? '⚠️ কিস্তি তালিকায় এই নাম আছে, কিন্তু সঠিক member নির্ধারণ হয়নি—সঠিক code/center নির্বাচন করুন।'
      : '🗂️ এই সদস্য কিস্তি তালিকায় নেই — এন্ট্রিটি "অন্যান্য আদায়" টেবিলে যাবে।';
    return;
  }
  el.textContent = '';
  el.className = 'today-entry-note hidden';
}
function fillTodayMemberByName() {
  state.todayInstallmentKey = '';
  const query=norm($('#today-member-name').value);
  if(!query) return;
  const ni=memberCol(state.memberDBHeaders,'name');
  const matches=state.memberDB.filter(row=>directoryRowVisible(row)&&ni>=0&&norm(row[ni])===query);
  if(matches.length!==1) return;
  const row=matches[0], ci=memberCol(state.memberDBHeaders,'center'), ki=memberCol(state.memberDBHeaders,'code');
  if(ci>=0){state.todayRawCenter=String(row[ci]||'').split(',')[0].trim();$('#today-center-code').value=displayCenterCode(state.todayRawCenter);}
  if(ki>=0){state.todayRawMember=String(row[ki]||'').trim();$('#today-member-code').value=displayMemberCode(row[ki]);}
  renderToday();
}
/* সদস্য তালিকার ড্রপডাউন একবারই বানাই — প্রতি কী-স্ট্রোকে ৫,০০০+ option নতুন করে বানালে অ্যাপ আটকে যায় */
let directoryOptionsCache = { key: '', code: '', name: '' };
function directoryOptionsKey() {
  return `${selectedStaffName()}:${state.memberDB.length}:${state.memberDBHeaders.length}:${state.memberDB[0]?.length || 0}:${state.memberDB[state.memberDB.length - 1]?.[0] ?? ''}`;
}
function renderTodayDirectoryOptions() {
  const codeList=$('#today-member-code-options'), nameList=$('#today-member-name-options');
  if(!codeList||!nameList) return;
  const key = directoryOptionsKey();
  if (directoryOptionsCache.key === key) {
    if (codeList.innerHTML !== directoryOptionsCache.code) codeList.innerHTML = directoryOptionsCache.code;
    if (nameList.innerHTML !== directoryOptionsCache.name) nameList.innerHTML = directoryOptionsCache.name;
    return;
  }
  const ci=memberCol(state.memberDBHeaders,'code'), ni=memberCol(state.memberDBHeaders,'name');
  const visibleDirectory = state.memberDB.filter(directoryRowVisible);
  const byCode=[...visibleDirectory].sort((a,b)=>compareAZ(ci>=0?a[ci]:'',ci>=0?b[ci]:'')||compareAZ(ni>=0?a[ni]:'',ni>=0?b[ni]:''));
  const codeHtml=byCode.map(row=>ci>=0?`<option value="${esc(displayMemberCode(row[ci]))}">${esc(ni>=0?row[ni]:'')}</option>`:'').join('');
  const byName=[...visibleDirectory].sort((a,b)=>compareAZ(ni>=0?a[ni]:'',ni>=0?b[ni]:'')||compareAZ(ci>=0?a[ci]:'',ci>=0?b[ci]:''));
  const nameHtml=byName.map(row=>ni>=0?`<option value="${esc(row[ni])}">${esc(ci>=0?displayMemberCode(row[ci]):'')}</option>`:'').join('');
  directoryOptionsCache = { key, code: codeHtml, name: nameHtml };
  codeList.innerHTML=codeHtml; nameList.innerHTML=nameHtml;
}

/* Today এন্ট্রি: মেম্বার কোড/নাম লিখলেই ইনপুটের নিচে দৃশ্যমান, ট্যাপযোগ্য সাজেশন।
   native datalist ফোনে সবসময় দেখা যায় না—তাই ছোট এই তালিকাটি আলাদা করে দেখানো হয়। */
const TODAY_SUGGESTION_LIMIT = 8;
function hideTodaySuggestions() {
  [['#today-code-suggestions', '#today-member-code'], ['#today-name-suggestions', '#today-member-name']].forEach(([panelSel, inputSel]) => {
    const panel = $(panelSel), input = $(inputSel);
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
    if (input) input.setAttribute('aria-expanded', 'false');
  });
}
function renderTodaySuggestions(kind) {
  const isCode = kind === 'code';
  const input = $(isCode ? '#today-member-code' : '#today-member-name');
  const panel = $(isCode ? '#today-code-suggestions' : '#today-name-suggestions');
  if (!input || !panel) return [];
  hideTodaySuggestions();
  const query = norm(input.value);
  const digits = normalizedDigits(query);
  if (!query || (isCode && !digits)) return [];

  const codeIndex = memberCol(state.memberDBHeaders, 'code');
  const nameIndex = memberCol(state.memberDBHeaders, 'name');
  const centerIndex = memberCol(state.memberDBHeaders, 'center');
  if (codeIndex < 0 || (!isCode && nameIndex < 0)) return [];

  const matches = [];
  for (let index = 0; index < state.memberDB.length; index++) {
    const row = state.memberDB[index];
    if (!directoryRowVisible(row)) continue;
    const rawCode = String(row[codeIndex] || '').trim();
    const code = displayMemberCode(rawCode);
    const name = nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '';
    const center = centerIndex >= 0 ? displayCenterCode(String(row[centerIndex] || '').split(',')[0]) : '';
    let score = -1;
    if (isCode) {
      const rawDigits = normalizedDigits(rawCode), shortDigits = normalizedDigits(code);
      if (rawDigits === digits || shortDigits === digits) score = 0;
      else if (shortDigits.startsWith(digits)) score = 1;
      else if (rawDigits.startsWith(digits)) score = 2;
      else if (shortDigits.endsWith(digits)) score = 3;
      else if (rawDigits.endsWith(digits)) score = 4;
      else if (rawDigits.includes(digits)) score = 5;
    } else {
      const candidate = norm(name);
      if (candidate === query) score = 0;
      else if (candidate.startsWith(query)) score = 1;
      else if (candidate.includes(query)) score = 2;
    }
    if (score >= 0) matches.push({ index, score, rawCode, code, name, center });
  }
  matches.sort((a, b) => a.score - b.score
    || (isCode ? compareMemberCodes(a.rawCode, b.rawCode) : compareAZ(a.name, b.name))
    || compareAZ(a.center, b.center));
  const shown = matches.slice(0, TODAY_SUGGESTION_LIMIT);
  if (!shown.length) return [];
  panel.innerHTML = shown.map((item) => `<button type="button" class="today-suggestion" role="option" aria-selected="false" data-today-suggestion="${item.index}" data-suggestion-kind="${kind}">
      <span class="today-suggestion-code">${esc(item.code || '—')}</span>
      <span class="today-suggestion-name">${esc(item.name || '—')}</span>
      <span class="today-suggestion-center">সেন্টার ${esc(item.center || '—')}</span>
    </button>`).join('')
    + (matches.length > shown.length ? `<div class="today-suggestion-more">আরও ${fmt(matches.length - shown.length)}টি মিলেছে — আরও কিছু লিখুন</div>` : '');
  panel.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
  return shown;
}
function selectTodaySuggestion(index, kind) {
  const row = state.memberDB[Number(index)];
  const codeIndex = memberCol(state.memberDBHeaders, 'code');
  if (!row || codeIndex < 0) return;
  // প্রথমে মূল কোড দিয়ে নির্দিষ্ট সদস্য বেছে নিই; fillTodayMember পরে UI-তে শেষ ৪ সংখ্যা দেখাবে।
  $('#today-member-code').value = String(row[codeIndex] || '').trim();
  state.todayRawMember = ''; state.todayRawCenter = '';
  fillTodayMember();
  const input = $(kind === 'name' ? '#today-member-name' : '#today-member-code');
  // কীবোর্ড নির্বাচনের পর ফোকাস ফেরানোর আগে/পরে যেন সাজেশন আবার না খুলে যায়, শেষে লুকাই।
  if (input) input.focus({ preventScroll: true });
  hideTodaySuggestions();
  saveTodayDraft();
}
function bindTodaySuggestionInput(kind) {
  const input = $(kind === 'code' ? '#today-member-code' : '#today-member-name');
  const panel = $(kind === 'code' ? '#today-code-suggestions' : '#today-name-suggestions');
  if (!input || !panel) return;
  input.addEventListener('input', () => renderTodaySuggestions(kind));
  input.addEventListener('focus', () => { if (input.value.trim()) renderTodaySuggestions(kind); });
  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== input && !panel.contains(document.activeElement)) {
      panel.classList.add('hidden'); panel.innerHTML = ''; input.setAttribute('aria-expanded', 'false');
    }
  }, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { hideTodaySuggestions(); return; }
    if (event.key === 'ArrowDown') {
      const first = $('[data-today-suggestion]', panel);
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  // ফোনে ট্যাপের সময় ইনপুটের ফোকাস/কীবোর্ড যেন না হারায়।
  panel.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-today-suggestion]')) event.preventDefault();
  });
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-today-suggestion]');
    if (button) selectTodaySuggestion(Number(button.dataset.todaySuggestion), kind);
  });
  panel.addEventListener('keydown', (event) => {
    const buttons = $$('[data-today-suggestion]', panel);
    const current = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); hideTodaySuggestions(); input.focus(); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !buttons.length) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown'
      ? Math.min(buttons.length - 1, Math.max(0, current + 1))
      : Math.max(0, current < 0 ? 0 : current - 1);
    buttons[next].focus();
  });
}
function normalizedDigits(value) { return toEn(String(value||'')).replace(/\D/g,''); }
function filteredDirectoryRows() {
  const codeQuery=norm($('#member-db-code-search')?.value||'');
  const centerQuery=norm($('#member-db-center-search')?.value||'');
  const codeIndex=memberCol(state.memberDBHeaders,'code');
  const centerIndex=memberCol(state.memberDBHeaders,'center');
  return state.memberDB.map((row,index)=>({row,index})).filter(({row})=>{
    if (!directoryRowVisible(row)) return false;
    const code=codeIndex>=0?norm(row[codeIndex]):'';
    const center=centerIndex>=0?norm(row[centerIndex]):'';
    const codeShort=codeIndex>=0?norm(displayMemberCode(row[codeIndex])):'';
    const centerShort=centerIndex>=0?norm(displayCenterCode(String(row[centerIndex]||'').split(',')[0].trim())):'';
    const codeOk=!codeQuery||code.includes(codeQuery)||codeShort.includes(codeQuery);
    const centerOk=!centerQuery||center.includes(centerQuery)||centerShort.includes(centerQuery);
    return codeOk&&centerOk;
  });
}
let balanceEntryLookup = new Map();
let activeBalanceCollection = null;
function renderBalanceDirectory() {
  const body = $('#balance-directory-list');
  if (!body) return;
  const headers = state.balanceHeaders;
  const idIndex = headers.findIndex((h) => /memberid|membercode|memberno/.test(normHeader(h)));
  const nameIndex = headers.findIndex((h) => /nameofmember|membername/.test(normHeader(h)));
  const savingsIndex = headers.findIndex((h) => /savings.*(outstanding|balance)/.test(normHeader(h)));
  const loanIndex = headers.findIndex((h) => /loan.*(outstanding|balance)/.test(normHeader(h)));
  const dpsIndex = headers.findIndex((h) => /dps.*(outstanding|balance)|deposit.*(outstanding|balance)/.test(normHeader(h)));
  const embeddedCenterIndex = memberCol(headers, 'center');
  const directoryCodeIndex = memberCol(state.memberDBHeaders, 'code');
  const directoryNameIndex = memberCol(state.memberDBHeaders, 'name');
  const directoryCenterIndex = memberCol(state.memberDBHeaders, 'center');
  const splitCenter = (value) => {
    const parts = String(value || '').split(',').map((part) => part.trim());
    return { code: parts.shift() || '', name: parts.join(', ').trim() };
  };
  const centerKey = (value) => normalizedDigits(splitCenter(value).code).replace(/^0+/, '') || norm(splitCenter(value).code) || '—';
  const centerNames = new Map();
  const addCenterName = (center, name) => {
    const key = centerKey(center), label = String(name || '').trim();
    if (center && label && !centerNames.has(key)) centerNames.set(key, label);
  };
  if (directoryCenterIndex >= 0) state.memberDB.forEach((row) => {
    const center = splitCenter(row[directoryCenterIndex]);
    addCenterName(center.code, center.name);
  });
  if (state.detect.centerCode >= 0 && state.detect.centerName >= 0) state.rows.forEach((row) => {
    addCenterName(row[state.detect.centerCode], row[state.detect.centerName]);
  });
  const totalize = (entries) => {
    const totals = entries.reduce((out, entry) => {
      out.loan += entry.loan; out.savings += entry.savings; out.dps += entry.dps;
      return out;
    }, { loan: 0, savings: 0, dps: 0 });
    totals.loan = roundMoney(totals.loan); totals.savings = roundMoney(totals.savings); totals.dps = roundMoney(totals.dps);
    totals.total = roundMoney(totals.loan + totals.savings + totals.dps);
    return totals;
  };
  const entries = idIndex < 0 ? [] : state.balanceRows.map((row, rowIndex) => {
    const rawCode = String(row[idIndex] || '').trim();
    if (!rawCode) return null;
    const appendedCenter = splitCenter(row[headers.length]).code;
    const embeddedCenter = embeddedCenterIndex >= 0 ? splitCenter(row[embeddedCenterIndex]).code : '';
    const rawCenter = appendedCenter || embeddedCenter;
    /* Center না থাকলে Today form-এর পুরোনো center hint ব্যবহার হবে না। */
    const directory = resolveDirectoryRow(rawCode, rawCenter || ' ');
    const directoryCenter = directory && directoryCenterIndex >= 0 ? splitCenter(directory[directoryCenterIndex]) : { code: '', name: '' };
    const code = directory && directoryCodeIndex >= 0 ? String(directory[directoryCodeIndex] || '').trim() : rawCode;
    /* কিছু পুরোনো balance import-এ appended center সব row-তে একই/পুরোনো হতে পারে।
       Directory match থাকলে সদস্যের সঠিক center-ই ব্যবহার করব। */
    const center = directoryCenter.code || rawCenter;
    const centerName = directoryCenter.name || centerNames.get(centerKey(center)) || '';
    const balanceName = nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '';
    const name = balanceName || (directory && directoryNameIndex >= 0 ? String(directory[directoryNameIndex] || '').trim() : '');
    const staff = directory ? directoryStaff(directory) : staffForMemberCode(code, center);
    if (directory ? !directoryRowVisible(directory) : !staffMemberAllowed(code, center)) return null;
    /* Full/short code, directory code ও unique-name—monthly member বাদ। */
    const monthlyByCode = findInstallmentRowForMember(code) >= 0;
    const monthlyByDirectory = directory && directoryCodeIndex >= 0 && findInstallmentRowForMember(directory[directoryCodeIndex]) >= 0;
    const monthlyByName = installmentNameRowIndexes(name, center).length > 0;
    if (monthlyByCode || monthlyByDirectory || monthlyByName) return null;
    const loan = loanIndex >= 0 ? num(row[loanIndex]) : 0;
    const savings = savingsIndex >= 0 ? num(row[savingsIndex]) : 0;
    const dps = dpsIndex >= 0 ? num(row[dpsIndex]) : 0;
    if (loan === 0 && savings === 0 && dps === 0) return null;
    return { rowIndex, rawCode, code, center, centerName, name, staff, loan, savings, dps, total: roundMoney(loan + savings + dps) };
  }).filter(Boolean);

  balanceEntryLookup = new Map(entries.map((entry) => [entry.rowIndex, entry]));
  const staffSelect = $('#f-staff'), centerSelect = $('#f-center');
  if (state.activePage === 'balance-directory') {
    const currentStaff = selectedStaffName() || state.filters.staff || staffSelect?.value || '';
    const staffNames = [...new Set(entries.map((entry) => entry.staff).filter(Boolean))].sort(compareAZ);
    if (staffSelect) {
      staffSelect.innerHTML = '<option value="">সব ষ্টাফ</option>' + staffNames.map((staff) => `<option value="${esc(staff)}">${esc(staff)}</option>`).join('');
      const staffOption = [...staffSelect.options].find((option) => norm(option.value) === norm(currentStaff));
      staffSelect.value = staffOption ? staffOption.value : '';
      state.filters.staff = staffSelect.value;
    }
    const currentCenter = state.filters.center || centerSelect?.value || '';
    const centerMap = new Map();
    entries.forEach((entry) => {
      const key = centerKey(entry.center);
      if (!centerMap.has(key)) centerMap.set(key, { value: entry.center, label: `${entry.centerName || 'সেন্টারের নাম নেই'} — ${displayCenterCode(entry.center) || '—'}`, code: displayCenterCode(entry.center) || '—' });
    });
    const centers = [...centerMap.values()].sort((a, b) => compareAZ(a.code, b.code));
    if (centerSelect) {
      centerSelect.innerHTML = '<option value="">সব সেন্টার</option>' + centers.map((center) => `<option value="${esc(center.value)}">${esc(center.label)}</option>`).join('');
      const centerOption = [...centerSelect.options].find((option) => option.value === currentCenter || centerKey(option.value) === centerKey(currentCenter));
      centerSelect.value = centerOption ? centerOption.value : '';
      state.filters.center = centerSelect.value;
    }
  }
  const selectedStaff = selectedStaffName() || state.filters.staff || staffSelect?.value || '';
  const selectedCenter = state.filters.center || centerSelect?.value || '';
  const query = state.filters.member || $('#f-member')?.value || '';
  const queryText = norm(query);
  const requestedSearchKey = state.filters.searchBy || $('#f-search-key')?.value || 'memberCode';
  const searchKey = requestedSearchKey === 'promiseDate' ? 'memberCode' : requestedSearchKey;
  const codeSearch = (searchQuery, values) => {
    const textQuery = norm(searchQuery);
    if (!textQuery) return true;
    const englishQuery = toEn(String(searchQuery ?? '')).trim();
    const digitQuery = /[a-zঀ-৿]/i.test(englishQuery) ? '' : normalizedDigits(englishQuery).replace(/^0+/, '');
    return values.some((value) => {
      if (norm(value).includes(textQuery)) return true;
      if (!digitQuery) return false;
      const digits = normalizedDigits(value).replace(/^0+/, '');
      return digits === digitQuery || (digitQuery.length >= 3 && digits.endsWith(digitQuery));
    });
  };
  const filtered = entries.filter((entry) => {
    const staffMatch = !selectedStaff || norm(entry.staff) === norm(selectedStaff);
    const centerMatch = !selectedCenter || centerKey(entry.center) === centerKey(selectedCenter);
    const searchMatch = !queryText
      || (searchKey === 'centerCode' && codeSearch(query, [entry.center, displayCenterCode(entry.center)]))
      || (searchKey === 'memberName' && norm(entry.name).includes(queryText))
      || (searchKey === 'memberCode' && codeSearch(query, [entry.rawCode, entry.code, displayMemberCode(entry.rawCode), displayMemberCode(entry.code)]));
    return staffMatch && centerMatch && searchMatch;
  });

  const groups = new Map();
  filtered.forEach((entry) => {
    const key = centerKey(entry.center);
    if (!groups.has(key)) groups.set(key, { code: displayCenterCode(entry.center) || '—', centerName: entry.centerName, entries: [] });
    const group = groups.get(key);
    if (!group.centerName && entry.centerName) group.centerName = entry.centerName;
    group.entries.push(entry);
  });
  body.innerHTML = [...groups.values()].sort((a, b) => compareAZ(a.code, b.code)).map((group) => {
    group.entries.sort((a, b) => compareMemberCodes(a.code, b.code) || compareAZ(a.name, b.name));
    const totals = totalize(group.entries);
    const rows = group.entries.map((entry) => `<tr class="balance-directory-row" data-balance-row-index="${entry.rowIndex}" tabindex="0" role="button"><td>${esc(displayMemberCode(entry.code))}</td><td>${esc(entry.name || '—')}</td><td class="amt">${fmtMoney(entry.loan)}</td><td class="amt">${fmtMoney(entry.savings)}</td><td class="amt">${fmtMoney(entry.dps)}</td><td class="amt">৳ ${fmtMoney(entry.total)}</td></tr>`).join('');
    return `<section class="balance-center-group">
      <div class="balance-center-header">
        <div class="balance-center-heading"><strong>🏢 ${esc(group.centerName || 'সেন্টারের নাম নেই')}</strong><span>সেন্টার কোড: ${esc(group.code)}</span></div>
        <span class="badge ok">${fmt(group.entries.length)} সদস্য</span>
      </div>
      <div class="table-wrap balance-center-table-wrap">
        <table class="balance-directory-table">
          <thead><tr><th>মেম্বার কোড</th><th>মেম্বার নাম</th><th class="amt">লোন স্থিতি</th><th class="amt">সঞ্চয় স্থিতি</th><th class="amt">DPS স্থিতি</th><th class="amt">মোট স্থিতি</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="balance-center-total"><td colspan="2" class="total-label">সেন্টার ${esc(group.code)} · মোট</td><td class="amt">${fmtMoney(totals.loan)}</td><td class="amt">${fmtMoney(totals.savings)}</td><td class="amt">${fmtMoney(totals.dps)}</td><td class="amt">৳ ${fmtMoney(totals.total)}</td></tr></tfoot>
        </table>
      </div>
    </section>`;
  }).join('');

  const totals = totalize(filtered);
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  setText('#balance-total-loan', fmtMoney(totals.loan));
  setText('#balance-total-savings', fmtMoney(totals.savings));
  setText('#balance-total-dps', fmtMoney(totals.dps));
  setText('#balance-total-total', `৳ ${fmtMoney(totals.total)}`);
  setText('#count-balance-directory', fmt(filtered.length));
  setText('#balance-directory-count', `${fmt(filtered.length)} সদস্য · ${fmt(groups.size)} সেন্টার · মাসিক কিস্তির সদস্য ও শূন্য স্থিতি বাদ`);
  const empty = $('#balance-directory-empty');
  if (empty) {
    empty.textContent = entries.length ? 'এই filter/search-এ কোনো তথ্য পাওয়া যায়নি।' : 'মাসিক কিস্তির সদস্য ও শূন্য স্থিতি বাদ দিলে কোনো সদস্য নেই।';
    empty.classList.toggle('hidden', filtered.length > 0);
  }
  $('#balance-directory-grand')?.classList.toggle('hidden', filtered.length === 0);
}

function openBalanceMemberDetails(rowIndex) {
  const entry = balanceEntryLookup.get(Number(rowIndex));
  if (!entry) return;
  const centerLabel = [entry.centerName, displayCenterCode(entry.center)].filter(Boolean).join(' · ') || '—';
  const base = [
    { label: 'মেম্বার কোড', value: displayMemberCode(entry.code) },
    { label: 'সেন্টার', value: centerLabel },
    { label: 'মেম্বার নাম', value: entry.name || '—' },
    { label: 'লোন স্থিতি', value: `৳ ${fmtMoney(entry.loan)}` },
    { label: 'সঞ্চয় স্থিতি', value: `৳ ${fmtMoney(entry.savings)}` },
    { label: 'DPS স্থিতি', value: `৳ ${fmtMoney(entry.dps)}` },
    { label: 'মোট স্থিতি', value: `৳ ${fmtMoney(entry.total)}` },
  ];
  const merged = mergeDirectoryDetails(base, entry.code, entry.center, entry.name);
  openMemberDetails(merged.entries, merged.mobile, `${entry.name || 'সদস্য'} · ${displayMemberCode(entry.code)}`, { ...entry, kind: 'balance', returnPage: 'balance-directory' });
}
function startBalanceCollection() {
  const entry = activeBalanceCollection;
  if (!entry || !canCollect()) return;
  if (!staffMemberAllowed(entry.code, entry.center)) { toast('Staff শুধু নিজের সদস্যের আদায় করতে পারবেন।', true); return; }
  $('#member-details-modal').classList.add('hidden');
  updateModalScrollLock();
  activeBalanceCollection = null;
  cancelTodayEdit(true);
  state.todayReturnPage = entry.returnPage || 'balance-directory';
  state.todayInstallmentKey = entry.kind === 'installment' ? String(entry.installmentKey || '') : '';
  state.todayRawCenter = entry.center;
  state.todayRawMember = entry.code;
  $('#today-center-code').value = displayCenterCode(entry.center);
  $('#today-member-code').value = displayMemberCode(entry.code);
  $('#today-member-name').value = entry.name || '';
  if (entry.kind === 'installment') autofillTodayLoan(entry.code);
  updateTodayEntryNote();
  showPage('today');
  $('#btn-return-page')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMemberDatabaseTable() {
  const body=$('#member-db-list'); if(!body) return;
  const codeIndex=memberCol(state.memberDBHeaders,'code');
  const centerIndex=memberCol(state.memberDBHeaders,'center');
  const nameIndex=memberCol(state.memberDBHeaders,'name');
  const mobileIndex=memberCol(state.memberDBHeaders,'mobile');
  const guardianIndex=memberCol(state.memberDBHeaders,'guardian');
  const result=filteredDirectoryRows();
  const visibleDirectoryCount = state.memberDB.filter(directoryRowVisible).length;
  $('#member-db-count').textContent=state.memberDB.length?`${fmt(result.length)} / ${fmt(visibleDirectoryCount)} সক্রিয় সদস্য · সারির যেকোনো জায়গায় ক্লিক করলে কল/details খুলবে`:'কিস্তির তালিকা ও পূর্বের স্থিতি আপলোড করুন।';
  const sorted=[...result].sort((a,b)=>compareAZ(codeIndex>=0?a.row[codeIndex]:'',codeIndex>=0?b.row[codeIndex]:'')||compareAZ(nameIndex>=0?a.row[nameIndex]:'',nameIndex>=0?b.row[nameIndex]:''));
  body.innerHTML=sorted.map(({row,index})=>`<tr class="member-db-row" data-member-db-index="${index}" tabindex="0" role="button">
      <td>${esc(displayMemberCode(row[codeIndex]||''))}</td><td>${esc(displayCenterCode(String(row[centerIndex]||'').split(',')[0].trim()))}</td>
    <td>${esc(row[nameIndex]||'')}</td><td>${esc(safeTelephone(row[mobileIndex]||'')||'—')}</td><td>${esc(row[guardianIndex]||'—')}</td></tr>`).join('');
  $('#member-db-empty').classList.toggle('hidden',result.length>0);
  $('.member-db-table').classList.toggle('hidden',result.length===0);
}
function openDirectoryMemberDetails(index) {
  const row=state.memberDB[index]; if(!row || !directoryRowVisible(row)) return;
  const codeIndex=memberCol(state.memberDBHeaders,'code');
  const mobileIndex=memberCol(state.memberDBHeaders,'mobile');
  const code=displayMemberCode(codeIndex>=0?row[codeIndex]:'');
  const nameIndex=memberCol(state.memberDBHeaders,'name');
  const entries=formatMemberDetails(state.memberDBHeaders.map((header,i)=>({label:header,value:row[i]||''})),codeIndex);
  openMemberDetails(entries,mobileIndex>=0?row[mobileIndex]:'',[code,nameIndex>=0?row[nameIndex]:''].filter(Boolean).join(' · '));
}

function currentMemberBalance(memberCode, memberName, centerCode) {
  const idIndex=state.balanceHeaders.findIndex(h=>normHeader(h).includes('memberid'));
  const nameIndex=state.balanceHeaders.findIndex(h=>normHeader(h).includes('nameofmember')||normHeader(h).includes('membername'));
  const centerDigits=normalizedDigits(centerCode);
  const directoryRow = resolveDirectoryRow(memberCode, centerCode);
  const directoryCodeIndex = memberCol(state.memberDBHeaders, 'code');
  const id=normalizedDigits(directoryRow && directoryCodeIndex >= 0 ? directoryRow[directoryCodeIndex] : memberCode);
  let candidates=state.balanceRows.filter(r=>{
    const rid=normalizedDigits(r[idIndex]);
    return rid && id && (id===rid || id.endsWith(rid) || rid.endsWith(id));
  });
  if(candidates.length>1){
    const exact=candidates.filter(r=>normalizedDigits(r[idIndex])===id);
    if(exact.length===1){candidates=exact;}
    else{
      const longest=candidates.filter(r=>normalizedDigits(r[idIndex]).length>=id.length);
      if(longest.length===1)candidates=longest;
    }
  }
  if(centerDigits && candidates.length>1){ const same=candidates.filter(r=>normalizedDigits(r[state.balanceHeaders.length])===centerDigits); if(same.length) candidates=same; }
  if(!candidates.length && nameIndex>=0 && memberName){
    const n=norm(memberName).replace(/[^a-z0-9]/g,'');
    candidates=state.balanceRows.filter(r=>norm(r[nameIndex]).replace(/[^a-z0-9]/g,'')===n && (!centerDigits || !r[state.balanceHeaders.length] || normalizedDigits(r[state.balanceHeaders.length])===centerDigits));
  }
  if(!candidates.length) return null;
  const row=candidates[0];
  const savingsIndex=state.balanceHeaders.findIndex(h=>/savings.*(outstanding|balance)/.test(normHeader(h)));
  const loanIndex=state.balanceHeaders.findIndex(h=>/loan.*(outstanding|balance)/.test(normHeader(h)));
  const dpsIndex=state.balanceHeaders.findIndex(h=>/dps.*(outstanding|balance)|deposit.*(outstanding|balance)/.test(normHeader(h)));
  return {loan:loanIndex>=0?num(row[loanIndex]):0,savings:savingsIndex>=0?num(row[savingsIndex]):0,dps:dpsIndex>=0?num(row[dpsIndex]):0};
}
/* Today All Collection-এর স্থিতি কার্ড — ২ লাইনে:
   ১ম লাইন = পূর্বের স্থিতি (CSV থেকে), ২য় লাইন = এন্ট্রি পরে স্থিতি
   (আজকের সেভ করা এন্ট্রি + এখন টাইপ করা অঙ্গ — সেভ করার আগেই লাইভ দেখায়)। */
function installmentChips(code) {
  const rowIndex = findInstallmentRowForMember(code);
  if (rowIndex < 0) return '<span class="balance-chip installment other">🗂️ অন্যান্য আদায়<b>কিস্তি তালিকায় নেই</b></span>';
  const row = state.rows[rowIndex], d = state.detect;
  const amount = d.amount >= 0 ? num(row[d.amount]) : 0;
  const st = rowStatus(row);
  const tone = st === 'paid' ? 'paid' : st === 'partial' ? 'partial' : 'due';
  return `<span class="balance-chip installment ${tone}">📅 ${shortDate(String(row[d.date] ?? ''))}</span>`
    + `<span class="balance-chip installment ${tone}">কিস্তি<b>৳ ${fmtMoney(amount)}</b></span>`;
}

function renderTodayBalanceCard() {
  const el = $('#today-balance-summary');
  if (!el) return;
  const typedCode = $('#today-member-code')?.value.trim() || '';
  const typedCenter = $('#today-center-code')?.value.trim() || '';
  const code = state.todayRawMember || typedCode;
  const centerHint = state.todayRawCenter || typedCenter;
  const row = resolveDirectoryRow(code, centerHint);
  const typed = {
    loan: num($('#today-loan')?.value),
    savings: num($('#today-savings')?.value),
    dps: num($('#today-dps')?.value),
  };
  const typedTotal = roundMoney(typed.loan + typed.savings + typed.dps);
  const chip = (kind, label, value) => `<span class="balance-chip ${kind}">${label}<b>${value}</b></span>`;

  if (!code) {
    el.innerHTML = `<div class="balance-card is-empty">${state.balanceRows.length
      ? `পূর্বের স্থিতির CSV লোড আছে (${fmt(state.balanceRows.length)} সারি)। মেম্বার কোড লিখুন।`
      : 'মেম্বার কোড লিখে সদস্য ও পূর্বের স্থিতি দেখুন।'}</div>`;
    return;
  }

  const ci = memberCol(state.memberDBHeaders, 'center');
  const ni = memberCol(state.memberDBHeaders, 'name');
  const name = row && ni >= 0 ? String(row[ni] || '').trim() : ($('#today-member-name')?.value.trim() || '');
  const centerCode = row && ci >= 0 ? String(row[ci] || '').split(',')[0].trim() : centerHint;
  const base = currentMemberBalance(code, name, centerCode);
  const key = dailyAccountKey({ memberCode: code, memberName: name, centerCode: centerCode });
  const saved = state.todayRows
    .filter((item) => dailyAccountKey(item) === key)
    .reduce((acc, item) => ({
      loan: acc.loan + num(item.loan),
      savings: acc.savings + num(item.savings),
      dps: acc.dps + num(item.dps),
    }), { loan: 0, savings: 0, dps: 0 });
  const after = base ? {
    loan: roundMoney(base.loan - saved.loan - typed.loan),
    savings: roundMoney(base.savings + saved.savings + typed.savings),
    dps: roundMoney(base.dps + saved.dps + typed.dps),
  } : null;
  const money = (value) => (base ? `৳ ${fmtMoney(value)}` : '—');

  el.innerHTML = `<div class="balance-card">
      <div class="balance-line">
        <span class="balance-tag">পূর্বের স্থিতি</span>
        <div class="balance-chips">
          ${chip('loan', 'লোন ', money(base ? base.loan : 0))}
          ${chip('savings', 'সঞ্চয় ', money(base ? base.savings : 0))}
          ${chip('dps', 'DPS ', money(base ? base.dps : 0))}
          ${installmentChips(code)}
        </div>
        ${base ? '' : '<span class="balance-note">পূর্বের স্থিতি CSV-তে পাওয়া যায়নি</span>'}
      </div>
      <div class="balance-line after">
        <span class="balance-tag">এন্ট্রি পরে স্থিতি</span>
        <div class="balance-chips">
          ${chip('loan', 'লোন ', money(after ? after.loan : 0))}
          ${chip('savings', 'সঞ্চয় ', money(after ? after.savings : 0))}
          ${chip('dps', 'DPS ', money(after ? after.dps : 0))}
          ${typedTotal > 0 ? `<span class="balance-chip pending">নতুন এন্ট্রি<b>৳ ${fmtMoney(typedTotal)}</b></span>` : ''}
        </div>
      </div>
    </div>`;
}

/* সদস্য কোড মিলিয়ে কিস্তি তালিকার সারি খোঁজা — Today পেজ থেকে আদায় নিলে ওই সারিই আপডেট হয় */
const memberCodeKey = (value) => normalizedDigits(value).replace(/^0+/, '');
function findInstallmentRowForMember(code) {
  const d = state.detect;
  const key = memberCodeKey(code);
  if (!key || d.memberCode < 0) return -1;
  const matches = [];
  state.rows.forEach((row, index) => { if (memberCodeKey(row[d.memberCode]) === key) matches.push(index); });
  if (!matches.length) return -1;
  const today = localDateInputValue();
  const open = matches.filter((i) => ['due', 'partial'].includes(rowStatus(state.rows[i])));
  const todaysOpen = open.filter((i) => rowDateISO(state.rows[i]) === today);
  if (todaysOpen.length) return todaysOpen[0];
  if (open.length) {
    const dated = open.filter((i) => rowDateISO(state.rows[i]));
    if (dated.length) return dated.sort((a, b) => compareAZ(rowDateISO(state.rows[a]), rowDateISO(state.rows[b])))[0];
    return open[0];
  }
  return matches[0];
}
/* Short code/full code/name—সব ক্ষেত্রে একই installment member চেনার সহায়ক।
   একই নামের ভিন্ন member থাকলে টাকা বসানোর জন্য অনুমান করা হয় না। */
function installmentNameRowIndexes(memberName, centerHint = '') {
  const d = state.detect;
  const name = norm(memberName);
  if (!name || d.memberName < 0) return [];
  let matches = [];
  state.rows.forEach((row, index) => { if (norm(row[d.memberName]) === name) matches.push(index); });
  const center = normalizedDigits(centerHint).replace(/^0+/, '');
  if (center && d.centerCode >= 0 && matches.length) {
    matches = matches.filter((index) => {
      const rowCenter = normalizedDigits(state.rows[index][d.centerCode]).replace(/^0+/, '');
      return rowCenter === center || (center.length <= 3 && rowCenter.endsWith(center));
    });
  }
  return matches;
}
function findInstallmentRowForEntry(item) {
  if (!item) return -1;
  let rowIndex = findInstallmentRowForMember(item.memberCode);
  if (rowIndex >= 0) return rowIndex;
  /* Save-এর আগের copy-তে শেষ ৪ সংখ্যা থাকলেও directory থেকে full code পাওয়া যায়। */
  const directory = resolveDirectoryRow(item.memberCode, item.centerCode);
  const codeIndex = memberCol(state.memberDBHeaders, 'code');
  if (directory && codeIndex >= 0) {
    rowIndex = findInstallmentRowForMember(directory[codeIndex]);
    if (rowIndex >= 0) return rowIndex;
  }
  /* Code পুরোনো/অসম্পূর্ণ হলে নাম ব্যবহার করা যায়, কিন্তু একই নামের ভিন্ন
     member থাকলে কোনো row বেছে টাকা বসানো নিরাপদ নয়। */
  const d = state.detect;
  const matches = installmentNameRowIndexes(item.memberName, item.centerCode);
  const memberKeys = new Set(matches.map((index) => memberCodeKey(state.rows[index][d.memberCode])).filter(Boolean));
  return memberKeys.size === 1 ? findInstallmentRowForMember([...memberKeys][0]) : -1;
}
function findRowByInstallmentKey(key) {
  if (!key) return -1;
  return state.rows.findIndex((row) => installmentRowKey(row) === key);
}
// এই এন্ট্রিটি "মাসিক আদায়" কি না — কিস্তি তালিকায় ওই সদস্য আছেন কি না
function isMonthlyEntry(item) {
  if (!item) return false;
  if (item.installmentKey) return true;
  /* কিস্তি তালিকায় নাম থাকলে অন্যান্য আদায়ে যাবে না—এমনকি পুরোনো entry-র
     code short হলেও। অস্পষ্ট একই নামও এখানে শুধু classification-এ monthly। */
  return findInstallmentRowForEntry(item) >= 0 || installmentNameRowIndexes(item.memberName, item.centerCode).length > 0;
}
function resolvedTodayInstallmentKey(item) {
  /* findRowByInstallmentKey প্রতিটি row-এর hash বানায়—প্রতি entry-তে সেটি
     ডাকলে initial render ধীর হয়। Member-এর বর্তমান row একবারে পেলে সেখান থেকেই key নিই। */
  const rowIndex = findInstallmentRowForEntry(item);
  if (rowIndex >= 0) return installmentRowKey(state.rows[rowIndex]);
  return String(item?.installmentKey || '');
}
function todayDuplicateSignature(item) {
  const installmentKey = resolvedTodayInstallmentKey(item);
  const account = installmentKey ? `installment:${installmentKey}` : `member:${dailyAccountKey(item)}`;
  return JSON.stringify([
    String(item.date || localDateInputValue()).slice(0, 10), account,
    roundMoney(num(item.loan)), roundMoney(num(item.savings)), roundMoney(num(item.dps)), roundMoney(num(item.total)),
  ]);
}
/* পুরোনো slow-save/double-tap-এর নিরাপদ duplicate copy পরিষ্কার করা।
   শুধু installment-linked entry-র একই অঙ্কের এমন copy সরাই যার installmentKey নেই
   এবং appliedLoan-ও ০—অর্থাৎ কিস্তির টাকায় এর কোনো প্রভাব নেই। */
function cleanupUnappliedTodayDuplicates() {
  const groups = new Map();
  state.todayRows.forEach((item, index) => {
    const key = todayDuplicateSignature(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, index });
  });
  const remove = new Set();
  groups.forEach((entries) => {
    if (entries.length < 2) return;
    /* installmentKey-এ paid-date-এর মতো পরিবর্তনশীল field থাকতে পারে, তাই
       পুরোনো key এখন match না করলেও keyless unapplied copy-টি সরানো নিরাপদ। */
    const anchored = entries.filter(({ item }) => Boolean(item.installmentKey))
      .sort((a, b) => compareAZ(a.item.createdAt, b.item.createdAt));
    if (!anchored.length) return;
    const keep = anchored[0];
    entries.forEach((candidate) => {
      if (candidate.index === keep.index || candidate.item.installmentKey || num(candidate.item.appliedLoan) > 0) return;
      /* Staff শুধু নিজের entry পরিষ্কার করবে; Admin সবগুলো পারবে। */
      if (!canEditEntry(candidate.item) || !canEditEntry(keep.item)) return;
      remove.add(candidate.index);
    });
  });
  if (!remove.size) return 0;
  const editingIndex = resolveTodayEditIndex();
  state.todayRows = state.todayRows.filter((_, index) => !remove.has(index));
  if (remove.has(editingIndex)) clearTodayEditTarget();
  return remove.size;
}

function renderToday() {
  const monthlyBody = $('#today-monthly-list'), otherBody = $('#today-other-list');
  if (!monthlyBody || !otherBody) return;
  renderTodayDirectoryOptions();
  const visibleTodayRows = state.todayRows.filter(entryVisibleToIdentity);
  $('#today-count-badge').textContent = fmt(visibleTodayRows.length);

  const rowsWithIndex = state.todayRows.map((item, index) => ({ item, index }))
    .filter(({ item }) => entryVisibleToIdentity(item))
    .sort((a, b) => compareMemberCodes(a.item.memberCode, b.item.memberCode) || compareAZ(a.item.createdAt, b.item.createdAt));
  const monthly = rowsWithIndex.filter(({ item }) => isMonthlyEntry(item));
  const others = rowsWithIndex.filter(({ item }) => !isMonthlyEntry(item));

  const totalize = (entries) => {
    const totals = entries.reduce((out, { item }) => {
      out.loan += num(item.loan); out.savings += num(item.savings); out.dps += num(item.dps);
      return out;
    }, { loan: 0, savings: 0, dps: 0 });
    totals.loan = roundMoney(totals.loan); totals.savings = roundMoney(totals.savings); totals.dps = roundMoney(totals.dps);
    totals.total = roundMoney(totals.loan + totals.savings + totals.dps);
    return totals;
  };
  const amountCells = (totals) => `<td class="amt">${fmtMoney(totals.loan)}</td><td class="amt">${fmtMoney(totals.savings)}</td><td class="amt">${fmtMoney(totals.dps)}</td><td class="amt">৳ ${fmtMoney(totals.total)}</td>`;
  const paint = (tbody, list, prefix) => {
    const groups = new Map();
    list.forEach((entry) => {
      const center = displayCenterCode(entry.item.centerCode) || '—';
      if (!groups.has(center)) groups.set(center, []);
      groups.get(center).push(entry);
    });
    let position = 0;
    const html = [];
    [...groups.entries()].sort((a, b) => compareAZ(a[0], b[0])).forEach(([center, entries]) => {
      entries.forEach(({ item, index }) => {
        const actions = canEditEntry(item)
          ? `<td class="row-actions"><button type="button" class="mini-btn edit" data-edit-today="${index}" title="এই এন্ট্রি এডিট করুন">✏️</button><button type="button" class="mini-btn del" data-del-today="${index}" title="এই এন্ট্রি মুছে ফেলুন">🗑️</button></td>`
          : '<td class="row-actions">—</td>';
        html.push(`<tr class="today-row" data-today-index="${index}" tabindex="0" role="button">
          <td>${fmt(++position)}</td><td>${esc(displayMemberCode(item.memberCode))}</td><td>${esc(displayCenterCode(item.centerCode))}</td><td>${esc(item.memberName)}</td>
          <td class="amt">${fmtMoney(item.loan)}</td><td class="amt">${fmtMoney(item.savings)}</td><td class="amt">${fmtMoney(item.dps)}</td><td class="amt">৳ ${fmtMoney(item.total)}</td>
          ${actions}</tr>`);
      });
      const centerLabel = center === '—' ? 'সেন্টার নেই' : `সেন্টার ${esc(center)}`;
      html.push(`<tr class="today-center-total" data-center-total="${esc(center)}">
        <td colspan="4" class="total-label">${centerLabel} · ${fmt(entries.length)}টি এন্ট্রি · মোট</td>
        ${amountCells(totalize(entries))}<td></td></tr>`);
    });
    tbody.innerHTML = html.join('');
    const totals = totalize(list);
    ['loan', 'savings', 'dps', 'total'].forEach((key) => {
      const cell = $(`#today-${prefix}-total-${key}`);
      if (cell) cell.textContent = key === 'total' ? `৳ ${fmtMoney(totals[key])}` : fmtMoney(totals[key]);
    });
    return totals;
  };
  const monthlyTotals = paint(monthlyBody, monthly, 'monthly');
  const otherTotals = paint(otherBody, others, 'other');

  /* প্রতিটি category-এর দেখানো loan/savings/DPS footer total-ই যোগ হয়।
     একই entries আবার পড়া হয় না, তাই কোনো আদায় দ্বিগুণ গণনা হয় না। */
  const combinedTotals = {
    loan: roundMoney(monthlyTotals.loan + otherTotals.loan),
    savings: roundMoney(monthlyTotals.savings + otherTotals.savings),
    dps: roundMoney(monthlyTotals.dps + otherTotals.dps),
  };
  combinedTotals.total = roundMoney(monthlyTotals.total + otherTotals.total);

  /* যে দিন যে staff-এর আদায় আছে শুধু সেই staff-এর member-entry table।
     কোনো empty staff table নয়; শেষে সকল স্টাফের category summary। */
  const staffGroups = new Map();
  const collectStaff = (list, category) => {
    list.forEach((entry) => {
      const staff = entryOwnerStaff(entry.item) || 'ষ্টাফ উল্লেখ নেই';
      if (!staffGroups.has(staff)) staffGroups.set(staff, { monthly: [], other: [] });
      staffGroups.get(staff)[category].push(entry);
    });
  };
  collectStaff(monthly, 'monthly');
  collectStaff(others, 'other');
  const staffAmountCells = (totals) => ['loan', 'savings', 'dps', 'total'].map((key) => `<td class="amt${key === 'total' ? ' total-grand' : ''}">${key === 'total' ? '৳ ' : ''}${fmtMoney(totals[key])}</td>`).join('');
  const staffTotalsRows = (groups) => `
    <tr class="staff-monthly-total" data-staff-total="monthly"><td colspan="4" class="total-label">মাসিক মোট</td>${staffAmountCells(totalize(groups.monthly))}</tr>
    <tr class="staff-other-total" data-staff-total="other"><td colspan="4" class="total-label">অন্যান্য মোট</td>${staffAmountCells(totalize(groups.other))}</tr>
    <tr class="staff-combined-total" data-staff-total="combined"><td colspan="4" class="total-label">সর্বমোট</td>${staffAmountCells(totalize([...groups.monthly, ...groups.other]))}</tr>`;
  const staffContainer = $('#today-staff-groups');
  if (staffContainer) {
    const cards = [...staffGroups.entries()].sort((a, b) => compareAZ(a[0], b[0])).map(([staff, groups]) => {
      const entries = [...groups.monthly.map((entry) => ({ ...entry, category: 'মাসিক' })), ...groups.other.map((entry) => ({ ...entry, category: 'অন্যান্য' }))].sort((a, b) => a.index - b.index);
      const rows = entries.map((entry) => `<tr data-staff-entry="${entry.index}"><td>${esc(displayMemberCode(entry.item.memberCode))}</td><td>${esc(displayCenterCode(entry.item.centerCode))}</td><td>${esc(entry.item.memberName || '—')}</td><td>${entry.category}</td>${amountCells(totalize([entry]))}</tr>`).join('');
      return `<section class="today-table-card table-card today-staff-entry-card" data-staff-card="${esc(staff)}">
        <div class="today-sub-head"><span class="th-title">👤 ${esc(staff)} <span class="badge ok">${fmt(entries.length)}</span></span></div>
        <div class="table-wrap"><table class="today-table today-staff-entry-table">
          <thead><tr><th>মেম্বার কোড</th><th>সেন্টার কোড</th><th>মেম্বার নাম</th><th>ধরন</th><th class="amt">লোন</th><th class="amt">সঞ্চয়</th><th class="amt">DPS</th><th class="amt">মোট</th></tr></thead>
          <tbody>${rows}</tbody><tfoot>${staffTotalsRows(groups)}</tfoot>
        </table></div>
      </section>`;
    });
    if (cards.length) cards.push(`<section class="today-table-card table-card today-staff-entry-card today-staff-all-card" id="today-staff-all-summary">
      <div class="today-sub-head"><span class="th-title">Σ সকল স্টাফ সর্বমোট <span class="badge ok">${fmt(monthly.length + others.length)}</span></span></div>
      <div class="table-wrap"><table class="today-table today-grand-table">
        <thead><tr><th>ক্যাটাগরি</th><th class="amt">লোন</th><th class="amt">সঞ্চয়</th><th class="amt">DPS</th><th class="amt">মোট</th></tr></thead>
        <tbody>
          <tr data-all-staff="monthly"><td class="total-label">মাসিক</td>${staffAmountCells(monthlyTotals)}</tr>
          <tr data-all-staff="other"><td class="total-label">অন্যান্য</td>${staffAmountCells(otherTotals)}</tr>
          <tr data-all-staff="combined"><td class="total-label">মাসিক + অন্যান্য</td>${staffAmountCells(combinedTotals)}</tr>
        </tbody>
      </table></div>
    </section>`);
    staffContainer.innerHTML = cards.join('');
  }
  $('#today-staff-empty')?.classList.toggle('hidden', staffGroups.size > 0);

  const closeBtn = $('#btn-close-today');
  if (closeBtn) {
    closeBtn.disabled = !canCollect() || visibleTodayRows.length === 0;
    closeBtn.title = !canCollect() ? 'Manager শুধু ডেটা দেখতে পারবেন'
      : visibleTodayRows.length === 0 ? 'ক্লোজ করার মতো এন্ট্রি নেই'
      : `${fmt(visibleTodayRows.length)}টি এন্ট্রি হিসাব ক্লোজ করে খাতায় জমা করুন`;
  }
  const todayIso = localDateInputValue();
  const oldEntries = visibleTodayRows.filter((item) => String(item.date || '').slice(0, 10) !== todayIso).length;
  if ($('#today-old-note')) {
    $('#today-old-note').textContent = oldEntries
      ? `⚠️ ${fmt(oldEntries)}টি এন্ট্রি আগের তারিখের — "হিসাব ক্লোজ" করলে ওই তারিখেই জমা হবে।`
      : '';
    $('#today-old-note').classList.toggle('hidden', oldEntries === 0);
  }
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
  const origins = monthly.reduce((counts, { item }) => {
    /* appliedLoan=0 হলে সেটি কিস্তির বাকী/আংশিক থেকে লোন আদায় নয়
       (যেমন শুধু সঞ্চয়)। পুরোনো record-এ field না থাকলে loan-ই প্রয়োজনীয় অঙ্ক। */
    const applied = item.appliedLoan == null ? num(item.loan) : num(item.appliedLoan);
    if (applied > 0) counts[num(item.prevActual) > 0 ? 'partial' : 'due'] += 1;
    return counts;
  }, { due: 0, partial: 0 });
  setText('#today-origin-due', fmt(origins.due));
  setText('#today-origin-partial', fmt(origins.partial));
  setText('#count-today-monthly', fmt(monthly.length));
  setText('#count-today-other', fmt(others.length));
  setText('#today-grand-loan', fmtMoney(combinedTotals.loan));
  setText('#today-grand-savings', fmtMoney(combinedTotals.savings));
  setText('#today-grand-dps', fmtMoney(combinedTotals.dps));
  setText('#today-grand-total', `৳ ${fmtMoney(combinedTotals.total)}`);
  const toggleEmpty = (sel, isEmpty) => { const el = $(sel); if (el) el.classList.toggle('hidden', !isEmpty); };
  toggleEmpty('#today-monthly-empty', monthly.length === 0);
  toggleEmpty('#today-other-empty', others.length === 0);
  renderTodayBalanceCard();
}
/* ---------- Today All Collection: এন্ট্রি এডিট / ডিলিট ---------- */
function revertAppliedLoan(item, d = state.detect) {
  if (!item) return false;
  const applied = num(item.appliedLoan);
  if (!(applied > 0) || d.actual < 0) return false;
  let rowIndex = findRowByInstallmentKey(item.installmentKey);
  if (rowIndex < 0) rowIndex = findInstallmentRowForMember(item.memberCode);
  if (rowIndex < 0) return false;
  const row = state.rows[rowIndex];
  row[d.actual] = String(roundMoney(Math.max(0, num(row[d.actual]) - applied)));
  if (d.paidDate >= 0 && item.appliedPaidDate && toISODate(row[d.paidDate]) === toISODate(item.appliedPaidDate)) {
    row[d.paidDate] = item.prevPaidDate || '';
  }
  reconcilePaidArchiveRow(row);
  return true;
}
async function deleteTodayRow(index) {
  const item = state.todayRows[index];
  if (!item) return;
  if (!canEditEntry(item)) { toast('আপনি শুধু নিজের এন্ট্রি মুছতে পারবেন।', true); return; }
  const label = item.memberName + ' — ৳ ' + fmtMoney(item.total);
  if (!window.confirm('এই এন্ট্রিটা মুছে ফেলবেন?\n\n' + label + '\n\nকিস্তি তালিকায় যে টাকা যোগ হয়েছিল সেটাও ফিরে যাবে।')) return;
  const snapshot = { todayRows: state.todayRows.map((x) => ({ ...x })), rows: state.rows.map((r) => [...r]), paidArchive: state.paidArchive.map((x) => ({ ...x })) };
  state.todayRows.splice(index, 1);
  revertAppliedLoan(item);
  const editIndex = resolveTodayEditIndex();
  if (editIndex === index) cancelTodayEdit(true);
  else if (editIndex > index) state.editingToday = editIndex - 1;
  renderTables(); renderToday();
  try {
    const saveResult = await persistRows({ background: true });
    toast(`🗑️ এন্ট্রি মুছে ফেলা হয়েছে${saveResult.background ? ' · Neon sync চলছে' : ''}`);
  } catch (e) {
    state.todayRows = snapshot.todayRows;
    state.rows = snapshot.rows;
    state.paidArchive = snapshot.paidArchive;
    state.detect = detectColumns(state.headers);
    renderTables(); renderToday();
    toast('⚠️ মুছে ফেলা সেভ হয়নি: ' + e.message, true);
  }
}
function startEditToday(index) {
  const item = state.todayRows[index];
  if (!item) return;
  if (!canEditEntry(item)) { toast('আপনি শুধু নিজের এন্ট্রি এডিট করতে পারবেন।', true); return; }
  state.editingToday = index;
  state.editingTodayId = String(item.id || '');
  state.editingHistoryId = '';
  state.todayRawMember = String(item.memberCode ?? '');
  state.todayRawCenter = String(item.centerCode ?? '');
  const set = (sel, value) => { const el = $(sel); if (el) el.value = value; };
  resetTodayAmountAuto();
  set('#today-member-code', displayMemberCode(item.memberCode));
  set('#today-center-code', displayCenterCode(item.centerCode));
  set('#today-member-name', item.memberName ?? '');
  set('#today-loan', item.loan ?? 0);
  set('#today-savings', item.savings ?? 0);
  set('#today-dps', item.dps ?? 0);
  set('#today-total', item.total ?? roundMoney(num(item.loan) + num(item.savings) + num(item.dps)));
  const loanInput = $('#today-loan');
  if (loanInput) loanInput.dataset.autofill = '0';
  const totalInput = $('#today-total');
  if (totalInput) { totalInput.dataset.autoCalc = '1'; totalInput.classList.add('auto-calculated'); }
  renderTodayBalanceCard();
  updateTodayEntryNote();
  const btn = $('#btn-add-today');
  if (btn) { btn.textContent = '💾 এন্ট্রি আপডেট'; btn.classList.add('editing'); }
  const cancel = $('#btn-cancel-edit');
  if (cancel) cancel.classList.remove('hidden');
  renderToday();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function cancelTodayEdit(silent = false) {
  clearTodayEditTarget();
  state.editingHistoryId = '';
  const btn = $('#btn-add-today');
  if (btn) { btn.textContent = '＋ তালিকায় যোগ'; btn.classList.remove('editing'); }
  const cancel = $('#btn-cancel-edit');
  if (cancel) cancel.classList.add('hidden');
  clearTodayForm();
  renderToday();
  if (!silent) toast('এডিট বাতিল হয়েছে');
}

/* ---------- দিনের হিসাব ক্লোজ: এন্ট্রি তারিখভিত্তিক স্থায়ী খাতায় জমা ---------- */
async function closeTodayAccount() {
  ensureEntryIds();
  if (!canCollect()) { toast('Manager শুধু ডেটা দেখতে পারবেন।', true); return; }
  const closing = state.todayRows.filter((item) => effectiveRole() === 'admin' || entryVisibleToIdentity(item));
  if (!closing.length) { toast('হিসাব ক্লোজ করার মতো আপনার এন্ট্রি নেই।'); return; }
  const closedAt = new Date().toISOString();
  const closeDate = localDateInputValue();
  const total = closing.reduce((sum, item) => sum + num(item.total), 0);
  if (!window.confirm(`${fmt(closing.length)}টি এন্ট্রি (মোট ৳ ${fmtMoney(total)}) হিসাব ক্লোজ করে তারিখভিত্তিক খাতায় জমা করবেন?\n\nকিস্তির আদায় অপরিবর্তিত থাকবে — শুধু Today পেজের তালিকা থেকে এই এন্ট্রিগুলো যাবে।`)) return;
  const closingIds = new Set(closing.map((item) => String(item.id)));
  const entries = closing.map((item) => ({
    ...item,
    id: String(item.id || uid()),
    date: String(item.date || closeDate).slice(0, 10),
    closeDate,
    closedAt,
    kind: isMonthlyEntry(item) ? 'monthly' : 'other',
    memberCode: String(item.memberCode ?? ''),
    centerCode: String(item.centerCode ?? ''),
    memberName: String(item.memberName ?? ''),
    installmentKey: String(item.installmentKey || ''),
    ownerStaff: String(item.ownerStaff || entryOwnerStaff(item) || ''),
    ownerRole: item.ownerRole || effectiveRole(),
    ownerDevice: item.ownerDevice || deviceId,
    loan: roundMoney(num(item.loan)),
    savings: roundMoney(num(item.savings)),
    dps: roundMoney(num(item.dps)),
    total: roundMoney(num(item.total)),
  }));
  const oldRows = [...state.todayRows], oldHistory = [...state.history];
  state.history = [...entries, ...state.history];
  state.todayRows = state.todayRows.filter((item) => !closingIds.has(String(item.id)));
  renderToday(); renderHistory(); updateTodayEntryNote();
  try {
    const result = await persistRows({ background: true });
    if ($('#history-date')) $('#history-date').value = closeDate;
    renderHistory();
    toast(result?.offline
      ? `📴 ${fmt(entries.length)}টি এন্ট্রি ডিভাইসে জমা হয়েছে—online এলে sync হবে`
      : result?.background
        ? `✅ ${fmt(entries.length)}টি এন্ট্রি খাতায় জমা হয়েছে · Neon sync চলছে`
        : `✅ হিসাব ক্লোজ হয়েছে — ${fmt(entries.length)}টি এন্ট্রি ৳ ${fmtMoney(total)} তারিখভিত্তিক খাতায় জমা হলো`);
  } catch (e) {
    state.todayRows = oldRows; state.history = oldHistory;
    renderToday(); renderHistory(); toast('⚠️ ক্লোজ সিঙ্ক হয়নি: ' + e.message, true);
  }
}

function filteredHistory() {
  const date = ($('#history-date')?.value || '').trim();
  return state.history.filter((item) => entryVisibleToIdentity(item) && (!date || String(item.date || '') === date));
}

/* ---------- হিসাবের খাতা: এন্ট্রি এডিট / ডিলিট ---------- */
/* খাতার এন্ট্রির টাকা কিস্তির Actual-এ যোগ/বিয়োগ করে — খাতা আর কিস্তি মিলে থাকে */
function adjustInstallmentForHistory(item, delta, d = state.detect) {
  if (!item || !delta || d.actual < 0) return false;
  let idx = item.installmentKey ? findRowByInstallmentKey(item.installmentKey) : -1;
  if (idx < 0) idx = findInstallmentRowForMember(item.memberCode);
  if (idx < 0) return false;
  const row = state.rows[idx];
  row[d.actual] = String(roundMoney(Math.max(0, num(row[d.actual]) + delta)));
  if (delta > 0 && d.paidDate >= 0) row[d.paidDate] = String(item.date || localDateInputValue()).slice(0, 10);
  reconcilePaidArchiveRow(row);
  return true;
}
function historyIndexById(id) {
  return state.history.findIndex((item) => String(item.id) === String(id));
}
async function deleteHistoryRow(id) {
  const index = historyIndexById(id);
  const item = state.history[index];
  if (!item) return;
  if (!canEditHistoryEntry(item)) { toast('আপনি শুধু নিজের খাতার এন্ট্রি মুছতে পারবেন।', true); return; }
  const label = `${item.memberName || '—'} — ৳ ${fmtMoney(num(item.total))}`;
  if (!window.confirm(`খাতার এই এন্ট্রিটি মুছে ফেলবেন?\n\n${shortDate(item.date)} · ${label}\n\nকিস্তিতে যে আদায় যোগ হয়েছিল সেটাও ফিরে যাবে।`)) return;
  const prevHistory = state.history.map((h) => ({ ...h }));
  const prevCells = state.rows.map((r) => [...r]);
  const prevArchive = state.paidArchive.map((item) => ({ ...item }));
  state.history.splice(index, 1);
  adjustInstallmentForHistory(item, -num(item.loan));
  if (state.editingHistoryId === String(id)) cancelHistoryEdit(true);
  renderTables(); renderToday(); renderHistory();
  try {
    const saveResult = await persistRows({ background: true });
    toast(`🗑️ খাতার এন্ট্রি মুছে ফেলা হয়েছে${saveResult.background ? ' · Neon sync চলছে' : ''}`);
  } catch (e) {
    state.history = prevHistory;
    state.rows = prevCells;
    state.paidArchive = prevArchive;
    state.detect = detectColumns(state.headers);
    renderTables(); renderToday(); renderHistory();
    toast('⚠️ মোছা সেভ হয়নি: ' + e.message, true);
  }
}
function fillFormFromHistory(item) {
  const set = (sel, value) => { const el = $(sel); if (el) el.value = value; };
  resetTodayAmountAuto();
  state.todayRawMember = String(item.memberCode ?? '');
  state.todayRawCenter = String(item.centerCode ?? '');
  set('#today-member-code', displayMemberCode(item.memberCode));
  set('#today-center-code', displayCenterCode(item.centerCode));
  set('#today-member-name', item.memberName ?? '');
  set('#today-loan', item.loan ?? 0);
  set('#today-savings', item.savings ?? 0);
  set('#today-dps', item.dps ?? 0);
  set('#today-total', item.total ?? roundMoney(num(item.loan) + num(item.savings) + num(item.dps)));
  const loanInput = $('#today-loan');
  if (loanInput) loanInput.dataset.autofill = '0';
  const totalInput = $('#today-total');
  if (totalInput) { totalInput.dataset.autoCalc = '1'; totalInput.classList.add('auto-calculated'); }
}
function setEditButtonMode(on, label) {
  const btn = $('#btn-add-today');
  if (btn) {
    btn.textContent = on ? label : '＋ তালিকায় যোগ';
    btn.classList.toggle('editing', on);
  }
  const cancel = $('#btn-cancel-edit');
  if (cancel) cancel.classList.toggle('hidden', !on);
}
function startEditHistory(id) {
  const item = state.history[historyIndexById(id)];
  if (!item) return;
  if (!canEditHistoryEntry(item)) { toast('আপনি শুধু নিজের খাতার এন্ট্রি এডিট করতে পারবেন।', true); return; }
  clearTodayEditTarget();
  state.editingHistoryId = String(item.id);
  fillFormFromHistory(item);
  saveTodayDraft();
  renderTodayBalanceCard();
  updateTodayEntryNote();
  setEditButtonMode(true, '💾 খাতার এন্ট্রি আপডেট');
  renderToday();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function cancelHistoryEdit(silent = false) {
  state.editingHistoryId = '';
  setEditButtonMode(false);
  clearTodayForm();
  renderToday();
  if (!silent) toast('খাতার এডিট বাতিল হয়েছে');
}
async function saveHistoryEdit(values) {
  const index = historyIndexById(state.editingHistoryId);
  const old = state.history[index];
  if (!old) return false;
  if (!canEditHistoryEntry(old)) { toast('আপনি শুধু নিজের খাতার এন্ট্রি বদলাতে পারবেন।', true); return false; }
  if (!staffMemberAllowed(values.code, values.centerCode)) { toast('এই সদস্য নির্বাচিত Staff-এর ডেটার মধ্যে নেই।', true); return false; }
  const newRowIndex = findInstallmentRowForMember(values.code);
  const newInstallmentKey = newRowIndex >= 0 ? installmentRowKey(state.rows[newRowIndex]) : '';
  const newInstallmentRef = newRowIndex >= 0 ? paidArchiveKey(state.rows[newRowIndex]) : '';
  const prevHistory = state.history.map((h) => ({ ...h }));
  const prevCells = state.rows.map((r) => [...r]);
  const prevArchive = state.paidArchive.map((item) => ({ ...item }));
  /* আগের টাকা কিস্তি থেকে তুলে নতুন টাকা বসাই */
  adjustInstallmentForHistory(old, -num(old.loan));
  adjustInstallmentForHistory({ ...old, memberCode: values.code, installmentKey: newInstallmentKey, installmentRef: newInstallmentRef }, num(values.loan));
  const total = roundMoney(values.loan + values.savings + values.dps);
  state.history[index] = {
    ...old,
    memberCode: values.code,
    centerCode: values.centerCode,
    memberName: values.memberName,
    loan: values.loan,
    savings: values.savings,
    dps: values.dps,
    total,
    installmentKey: newInstallmentKey,
    installmentRef: newInstallmentRef,
    ownerStaff: effectiveRole() === 'staff' ? selectedStaffName() : (staffForMemberCode(values.code, values.centerCode) || old.ownerStaff || ''),
    kind: isMonthlyEntry({ memberCode: values.code, installmentKey: newInstallmentKey }) ? 'monthly' : 'other',
    updatedAt: new Date().toISOString(),
  };
  renderTables(); renderToday(); renderHistory();
  try {
    const saveResult = await persistRows({ background: true });
    state.editingHistoryId = '';
    setEditButtonMode(false);
    clearTodayForm();
    renderToday(); renderHistory();
    toast(`💾 খাতার এন্ট্রি আপডেট হয়েছে${saveResult.background ? ' · Neon sync চলছে' : ''}`);
    return true;
  } catch (e) {
    state.history = prevHistory;
    state.rows = prevCells;
    state.paidArchive = prevArchive;
    state.detect = detectColumns(state.headers);
    renderTables(); renderToday(); renderHistory();
    toast('⚠️ আপডেট সেভ হয়নি: ' + e.message, true);
    return false;
  }
}

function renderHistory() {
  const tbody = $('#history-list'); if (!tbody) return;
  const items = [...filteredHistory()]
    .sort((a, b) => compareAZ(a.date, b.date) || compareMemberCodes(a.memberCode, b.memberCode) || compareAZ(a.memberName, b.memberName));
  const totals = items.reduce((out, item) => {
    out.loan += num(item.loan); out.savings += num(item.savings); out.dps += num(item.dps); out.total += num(item.total);
    if (item.kind === 'monthly') out.monthly += num(item.total); else out.other += num(item.total);
    return out;
  }, { loan: 0, savings: 0, dps: 0, total: 0, monthly: 0, other: 0 });

  const dateInput = $('#history-date');
  const filterLabel = dateInput && dateInput.value ? shortDate(dateInput.value) : 'সব তারিখ';
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
  setText('#count-history', fmt(items.length));
  setText('#history-filter-label', filterLabel);
  tbody.innerHTML = items.map((item) => {
    const actions = canEditHistoryEntry(item)
      ? `<td class="row-actions"><button type="button" class="mini-btn edit" data-edit-history="${esc(item.id)}" title="এই খাতার এন্ট্রি বদলান">✏️</button><button type="button" class="mini-btn del" data-del-history="${esc(item.id)}" title="এই খাতার এন্ট্রি মুছুন">🗑️</button></td>`
      : '<td class="row-actions">—</td>';
    return `<tr class="${item.kind === 'monthly' ? 'history-monthly' : 'history-other'}">
    <td>${esc(shortDate(item.date))}</td>
    <td><span class="kind-chip ${item.kind === 'monthly' ? 'monthly' : 'other'}">${item.kind === 'monthly' ? '📅 মাসিক' : '🗂️ অন্যান্য'}</span></td>
    <td>${esc(displayMemberCode(item.memberCode) || '—')}</td>
    <td>${esc(displayCenterCode(item.centerCode) || '—')}</td>
    <td class="history-name">${esc(item.memberName || '—')}</td>
    <td class="amt">${fmtMoney(num(item.loan))}</td>
    <td class="amt">${fmtMoney(num(item.savings))}</td>
    <td class="amt">${fmtMoney(num(item.dps))}</td>
    <td class="amt history-total">৳ ${fmtMoney(num(item.total))}</td>
    ${actions}
  </tr>`;
  }).join('');
  const empty = $('#history-empty');
  if (empty) {
    empty.textContent = state.history.length
      ? `${filterLabel} তারিখে কোনো হিসাব নেই।`
      : 'এখনো কোনো হিসাব ক্লোজ করা হয়নি — "✔️ হিসাব ক্লোজ" চাপলে আজকের এন্ট্রি এখানে জমা হবে।';
    empty.classList.toggle('hidden', items.length > 0);
  }
  const table = $('#history-table');
  if (table) table.classList.toggle('hidden', items.length === 0);
}

/* এন্ট্রি ফর্মের সব ঘর ফাঁকা (তালিকা বা কিস্তির ডেটা অপরিবর্তিত) */
function clearTodayForm() {
  hideTodaySuggestions();
  ['today-member-code','today-center-code','today-member-name','today-loan','today-savings','today-dps','today-total'].forEach((id) => {
    const el = $('#' + id); if (el) el.value = '';
  });
  clearTodayDraft();
  resetTodayAmountAuto();
  const loan = $('#today-loan'); if (loan) loan.dataset.autofill = '0';
  state.todayRawMember = ''; state.todayRawCenter = ''; state.todayInstallmentKey = '';
  updateTodayEntryNote();
  renderTodayBalanceCard();
}

let todayEntrySaveLock = false;
async function addTodayRow() {
  if (todayEntrySaveLock) { toast('⏳ আগের এন্ট্রি সেভ হচ্ছে—আবার চাপার প্রয়োজন নেই।'); return false; }
  todayEntrySaveLock = true;
  const submitButton = $('#btn-add-today');
  if (submitButton) submitButton.disabled = true;
  try {
  if (!canCollect()) { toast('Manager শুধু ডেটা দেখতে পারবেন; এন্ট্রি করা যাবে না।', true); return; }
  const requestedEdit = resolveTodayEditIndex();
  if (state.editingTodayId && requestedEdit < 0) {
    toast('⚠️ যে এন্ট্রিটি এডিট করছিলেন সেটি আর Today তালিকায় নেই—আবার তালিকা থেকে ✏️ চাপুন।', true);
    cancelTodayEdit(true);
    return;
  }
  if (requestedEdit >= 0 && !canEditEntry(state.todayRows[requestedEdit])) { toast('আপনি শুধু নিজের এন্ট্রি এডিট করতে পারবেন।', true); return; }
  const typedCode = $('#today-member-code').value.trim();
  const typedCenter = $('#today-center-code').value.trim();
  let code = state.todayRawMember || typedCode;
  let centerCode = state.todayRawCenter || typedCenter;
  let memberName = $('#today-member-name').value.trim();
  /* Save button-এর ভেতরেই short code canonicalize করি। আগের save চলাকালে
     raw code clear হয়ে গেলেও দ্বিতীয় tap যেন ‘অন্যান্য’ entry তৈরি না করে। */
  const match = resolveDirectoryRow(typedCode, typedCenter)
    || (code !== typedCode ? resolveDirectoryRow(code, centerCode) : null)
    || findDirectoryMember(code, centerCode);
  const directoryCodeIndex = memberCol(state.memberDBHeaders, 'code');
  const directoryCenterIndex = memberCol(state.memberDBHeaders, 'center');
  const directoryNameIndex = memberCol(state.memberDBHeaders, 'name');
  if (match && directoryCodeIndex >= 0) code = String(match[directoryCodeIndex] || code).trim();
  if (match && directoryCenterIndex >= 0) centerCode = String(match[directoryCenterIndex] || centerCode).split(',')[0].trim();
  if (match && directoryNameIndex >= 0 && !memberName) memberName = String(match[directoryNameIndex] || '').trim();
  if (!code || !memberName) { toast('মেম্বার কোড ও নাম লিখুন।', true); return; }
  autoCalculateTodayAmounts();
  const loan = roundMoney(num($('#today-loan').value));
  const savings = roundMoney(num($('#today-savings').value));
  const dps = roundMoney(num($('#today-dps').value));
  const componentTotal = roundMoney(loan + savings + dps);
  const hasTypedTotal = $('#today-total').value.trim() !== '';
  const typedTotal = roundMoney(num($('#today-total').value));
  if (hasTypedTotal && Math.abs(typedTotal - componentTotal) > 0.009) {
    const message = `মোট ও তিনটি অংকের যোগফল মিলছে না—মোট ৳ ${fmtMoney(componentTotal)} হওয়া উচিত।`;
    setTodayAmountNote('⚠️ ' + message, true); toast('⚠️ ' + message, true); return;
  }
  const total = hasTypedTotal ? typedTotal : componentTotal;
  if ([loan,savings,dps,total].some((v)=>v<0) || total<=0) { toast('সঠিক আদায়ের পরিমাণ লিখুন।', true); return; }
  const d = state.detect;
  // Details → আদায়ের clicked কিস্তি target থাকে; edit-এ existing entry-র own matching ব্যবহার হয়।
  const targetedRowIndex = requestedEdit >= 0 || state.editingHistoryId ? -1 : targetedTodayInstallmentRow(code, centerCode);
  const rowIndex = targetedRowIndex >= 0 ? targetedRowIndex : findInstallmentRowForEntry({ memberCode: code, centerCode, memberName });
  if (rowIndex < 0 && installmentNameRowIndexes(memberName, centerCode).length) {
    toast('⚠️ কিস্তি তালিকায় এই নাম আছে, কিন্তু একই নামের একাধিক member/ভুল center—সঠিক code/center নির্বাচন করুন। অন্যান্য আদায়ে যোগ করা হয়নি।', true);
    return;
  }
  if (rowIndex >= 0) {
    const installment = state.rows[rowIndex];
    if (d.memberCode >= 0) code = String(installment[d.memberCode] || code).trim();
    if (d.centerCode >= 0) centerCode = String(installment[d.centerCode] || centerCode).trim();
  }
  if (!staffMemberAllowed(code, centerCode)) { toast('এই সদস্য নির্বাচিত Staff-এর ডেটার মধ্যে নেই।', true); return; }
  /* খাতার কোনো এন্ট্রি এডিট হচ্ছে? তাহলে নতুন সারি নয় — ওই এন্ট্রিই আপডেট হবে */
  if (state.editingHistoryId) {
    await saveHistoryEdit({ code, centerCode, memberName, loan, savings, dps });
    return;
  }
  const editingIndex = requestedEdit;
  const editingItem = editingIndex >= 0 ? state.todayRows[editingIndex] : null;
  const installmentKey = rowIndex >= 0 ? installmentRowKey(state.rows[rowIndex]) : '';
  const duplicateCandidate = {
    memberCode: code, centerCode, memberName, installmentKey,
    date: editingItem?.date || localDateInputValue(), loan, savings, dps, total,
  };
  const duplicateSignature = todayDuplicateSignature(duplicateCandidate);
  const duplicate = state.todayRows.some((item, index) => index !== editingIndex && todayDuplicateSignature(item) === duplicateSignature);
  if (duplicate) {
    toast('⚠️ একই সদস্য/কিস্তির একই অঙ্কের আদায় আজকের তালিকায় আগেই আছে—ডাবল এন্ট্রি হয়নি। বদলাতে ✏️ চাপুন।', true);
    return;
  }
  let prevActual = rowIndex >= 0 && d.actual >= 0 ? String(state.rows[rowIndex][d.actual] ?? '') : '';
  let prevPaidDate = rowIndex >= 0 && d.paidDate >= 0 ? String(state.rows[rowIndex][d.paidDate] ?? '') : '';

  const previousRows = [...state.todayRows];
  const oldFollowups = [...state.followups];
  const previousRowCells = state.rows.map((r) => [...r]);
  const previousArchive = state.paidArchive.map((item) => ({ ...item }));
  let clearedFollowup = false;
  const appliedPaidDate = editingItem?.date || localDateInputValue();
  if (editingItem) {
    revertAppliedLoan(editingItem, d);
    /* Origin count ও পরবর্তী edit/delete-এর baseline হিসাবেও revert-এর পরের
       actual লাগবে; edit-এর আগের আদায় যোগ থাকা সংখ্যা নয়। */
    if (rowIndex >= 0 && d.actual >= 0) prevActual = String(state.rows[rowIndex][d.actual] ?? '');
    /* এডিটের আগের তারিখ নয়—revert-এর পর row-তে যে তারিখ ফিরেছে সেটিই পরবর্তী
       delete-এর আগের অবস্থা। */
    if (rowIndex >= 0 && d.paidDate >= 0) prevPaidDate = String(state.rows[rowIndex][d.paidDate] ?? '');
  }
  if (rowIndex >= 0 && loan > 0 && d.actual >= 0) {
    const row = state.rows[rowIndex];
    row[d.actual] = String(roundMoney(num(row[d.actual]) + loan));
    if (d.paidDate >= 0) row[d.paidDate] = appliedPaidDate;
    // পুরো কিস্তি শোধ হলে (বাকী → আদায় বা আংশিক → আদায়) প্রতিশ্রুতি/পরবর্তী তারিখ স্বয়ংক্রিয়ভাবে মুছে যায়
    if (num(row[d.actual]) >= num(row[d.amount])) {
      const key = followupKey(row);
      clearedFollowup = state.followups.some((item) => item.key === key);
      if (clearedFollowup) state.followups = state.followups.filter((item) => item.key !== key);
    }
  }
  const entry = {
    id: editingItem?.id || uid(),
    memberCode: code, centerCode, memberName, loan, savings, dps,
    total, date: localDateInputValue(), createdAt: new Date().toISOString(),
    memberIndex: match ? state.memberDB.indexOf(match) : -1,
    installmentKey, installmentRef: rowIndex >= 0 ? paidArchiveKey(state.rows[rowIndex]) : (editingItem?.installmentRef || ''),
    ownerStaff: editingItem?.ownerStaff || selectedStaffName() || staffForMemberCode(code, centerCode),
    ownerRole: editingItem?.ownerRole || effectiveRole(), ownerDevice: editingItem?.ownerDevice || deviceId,
    appliedLoan: rowIndex >= 0 && loan > 0 && d.actual >= 0 ? loan : 0, prevActual,
    prevPaidDate, appliedPaidDate: rowIndex >= 0 && loan > 0 && d.paidDate >= 0 ? appliedPaidDate : '',
  };
  if (editingItem) {
    entry.date = editingItem.date || entry.date;
    entry.createdAt = editingItem.createdAt || entry.createdAt;
    state.todayRows[editingIndex] = entry;
  } else {
    state.todayRows.unshift(entry);
  }
  archiveCurrentPaidInstallments();
  state.todayRawMember = ''; state.todayRawCenter = '';
  renderTables(); renderToday();
  try {
    const saveResult = await persistRows({ background: true });
    if (editingItem) { clearTodayEditTarget(); const b = $('#btn-add-today'); if (b) { b.textContent = '＋ তালিকায় যোগ'; b.classList.remove('editing'); } const c = $('#btn-cancel-edit'); if (c) c.classList.add('hidden'); }
    clearTodayForm(); renderToday();
    const fullPaid = installmentKey && num(prevActual) + loan >= num(state.rows[rowIndex]?.[d.amount]);
    const syncNote = saveResult?.background ? ' · Neon sync চলছে' : '';
    if (saveResult?.offline) { toast('📴 এন্ট্রি এই ডিভাইসে সেভ হয়েছে—online এলে auto-sync হবে'); return; }
    toast(installmentKey
      ? (fullPaid
        ? `✅ পুরো কিস্তি শোধ — সদস্য আদায় কিস্তিতে চলে গেছেন${clearedFollowup ? ' · প্রতিশ্রুতি মুছে গেছে' : ''}${syncNote}`
        : `✅ আংশিক আদায় সেভ — সদস্য আংশিকে আছেন, বাকী ৳ ${fmtMoney(Math.max(0, num(state.rows[rowIndex]?.[d.amount]) - num(prevActual) - loan))}${syncNote}`)
      : `✅ এন্ট্রি সেভ হয়েছে${syncNote || '—সব ডিভাইসে দেখা যাবে'}`);
  } catch(e) {
    state.todayRows = previousRows;
    state.followups = oldFollowups;
    state.rows = previousRowCells;
    state.paidArchive = previousArchive;
    state.detect = detectColumns(state.headers);
    renderTables(); renderToday(); toast('⚠️ এন্ট্রি সিঙ্ক হয়নি: '+e.message,true);
  }
  } finally {
    todayEntrySaveLock = false;
    if (submitButton) submitButton.disabled = false;
  }
}
function openTodayDetails(index) {
  const item = state.todayRows[index]; if (!item || !entryVisibleToIdentity(item)) return;
  const row = findDirectoryMember(item.memberCode);
  const entries = row ? formatMemberDetails(state.memberDBHeaders.map((header,i)=>({label:header,value:row[i]})), memberCol(state.memberDBHeaders,'code')) : [];
  entries.unshift({label:'আজকের লোন',value:fmtMoney(item.loan)},{label:'আজকের সঞ্চয়',value:fmtMoney(item.savings)},{label:'আজকের DPS',value:fmtMoney(item.dps)},{label:'আজকের মোট',value:fmtMoney(item.total)});
  const baseline=currentMemberBalance(item.memberCode,item.memberName,item.centerCode);
  if(baseline){const sums=state.todayRows.filter(x=>dailyAccountKey(x)===dailyAccountKey(item)).reduce((a,x)=>({loan:a.loan+num(x.loan),savings:a.savings+num(x.savings),dps:a.dps+num(x.dps)}),{loan:0,savings:0,dps:0});entries.unshift({label:'সর্বশেষ লোন স্থিতি',value:fmtMoney(baseline.loan-sums.loan)},{label:'সর্বশেষ সঞ্চয় স্থিতি',value:fmtMoney(baseline.savings+sums.savings)},{label:'সর্বশেষ DPS স্থিতি',value:fmtMoney(baseline.dps+sums.dps)});}
  const mi=memberCol(state.memberDBHeaders,'mobile'); const mobile=row&&mi>=0?row[mi]:'';
  openMemberDetails(stripHiddenDetails(entries),mobile,`${item.memberCode} · ${item.memberName}`);
}
function importMemberCSV() {
  const message = 'সদস্য তালিকা আপলোড বন্ধ—কিস্তির তালিকা ও পূর্বের স্থিতি ব্যবহার করুন।';
  if ($('#member-csv-status')) $('#member-csv-status').textContent = message;
  toast(message, true);
}
/* পূর্বের স্থিতির CSV — দুই ধরনের ফরম্যাট সমর্থন করে:
   ১) নতুন: Member ID | Member Name | Savings Balance | DPS Balance | Loan Balance
      (+ "Item Code: XX.XX Item Name: …" লোন-প্রোডাক্ট গ্রুপ সারি, একই সদস্যের একাধিক প্রোডাক্টের সারি যোগ করা হয়)
   ২) পুরোনো: Member ID | Name of Member | Savings Outstanding Balance | Loan Outstanding
      (+ "Samity: 0001, …" সেন্টার সারি — প্রতিটি সারি আলাদা রাখা হয়) */
function findBalanceHeaderRow(rows) {
  return rows.findIndex((row) => {
    const headers = row.map(normHeader);
    const hasId = headers.some((h) => h.includes('memberid') || h.includes('membercode') || h.includes('memberno'));
    const hasName = headers.some((h) => h.includes('nameofmember') || h.includes('membername'));
    const hasBalance = headers.some((h) => (h.includes('loan') && (h.includes('outstanding') || h.includes('balance')))
      || (h.includes('savings') && (h.includes('outstanding') || h.includes('balance'))));
    return hasId && hasName && hasBalance;
  });
}
function importBalanceCSV(file) {
  if (!requireAdminOnline()) return;
  parseReportFile(file).then((fileRows)=>{
    let old=null;
    return (async()=>{
    try {
      const rules=window.COLLECTION_CSV;
      if(!rules)throw new Error('সিঙ্ক ফাইল লোড হয়নি—পেজটি একবার রিফ্রেশ করুন।');
      const parsed=rules.parseBalanceRows(fileRows.rows);
      const headers=parsed.headers;const rows=parsed.rows;const stats=parsed.stats;
      old={headers:state.balanceHeaders,rows:state.balanceRows,memberHeaders:state.memberDBHeaders,memberRows:state.memberDB};state.balanceHeaders=headers;state.balanceRows=rows;
      pruneMemberDBToActive({ markForSync: true });
      await persistRows({ allowOffline: false });
      const totals=stats.totals;
      $('#balance-csv-status').innerHTML=`✅ <b>${fmt(stats.members)}</b> জনের স্থিতি Neon-এ সিঙ্ক হয়েছে (${fmt(stats.records)} সারি থেকে)।<br>মোট লোন ৳ ${fmtMoney(totals.loan)} · সঞ্চয় ৳ ${fmtMoney(totals.savings)} · DPS ৳ ${fmtMoney(totals.dps)}${stats.hasDps?'':' — <b>ফাইলে DPS কলাম নেই, পূর্বের DPS 0 ধরা হয়েছে</b>'}`;
      $('#member-csv-modal').classList.remove('hidden');updateModalScrollLock();renderToday();toast('✅ পূর্বের স্থিতি সব ডিভাইসে সিঙ্ক হয়েছে');
    } catch(e) {
      if(old){state.balanceHeaders=old.headers;state.balanceRows=old.rows;state.memberDBHeaders=old.memberHeaders;state.memberDB=old.memberRows;}
      $('#balance-csv-status').textContent='⚠️ '+e.message;$('#member-csv-modal').classList.remove('hidden');updateModalScrollLock();
    }
    })();
  }).catch((e)=>{
    $('#balance-csv-status').textContent='⚠️ '+e.message;$('#member-csv-modal').classList.remove('hidden');updateModalScrollLock();
  });
}
/* ============================================================
   MIS ফাইল একসাথে আপলোড — CSV · লেগ্য .xls · HTML
   শুধু কিস্তির তালিকা + পূর্বের স্থিতি; ৫,০৮১ সদস্যের আলাদা তালিকা আর নেই।
   ============================================================ */
const misSlots = { installment: null, balance: null };
const MIS_SLOT_LABEL = { installment: '① কিস্তির তালিকা', balance: '② পূর্বের স্থিতি' };
const MIS_FORMAT_LABEL = { xls: 'লেগ্য .xls', html: 'HTML', csv: 'CSV' };

function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error('ফাইলটি পড়া যায়নি।'));
    reader.readAsArrayBuffer(file);
  });
}
/* যেকোনো ফরম্যাটের ফাইল পড়ে সারি বের করে + কী রিপোর্ট তা শনাক্ত করে */
async function parseReportFile(file) {
  const rules = window.COLLECTION_CSV;
  if (!rules) throw new Error('পার্সিং ফাইল লোড হয়নি — পেজটি একবার রিফ্রেশ করুন।');
  const bytes = await readFileBytes(file);
  const { rows, format } = rules.readReportRows(bytes);
  const detected = rules.detectReportType(rows);
  return { rows, format, type: detected.type, headerIndex: detected.headerIndex, name: file.name || 'ফাইল' };
}
function renderMisSlots() {
  ['installment', 'balance'].forEach((slot) => {
    const el = $('#mis-status-' + slot);
    if (!el) return;
    const item = misSlots[slot];
    if (!item) { el.innerHTML = '<span class="miss">— ফাইল বাছা হয়নি</span>'; return; }
    const fmtLabel = MIS_FORMAT_LABEL[item.format] || item.format;
    el.innerHTML = `✅ <b>${esc(item.name)}</b><br>${esc(MIS_SLOT_LABEL[slot])} · ${esc(fmtLabel)} · ${fmt(item.rows.length)} সারি`;
  });
  const btn = $('#btn-apply-mis-files');
  if (btn) btn.disabled = !Object.values(misSlots).some(Boolean);
}
/* ফাইল বেছে নিলে সাথে সাথে পড়ে দেখায় — কোনটি কী রিপোর্ট তা লেখা থাকে */
async function handleMisFile(file) {
  if (!requireAdminOnline()) return;
  const status = $('#mis-upload-status');
  try {
    const parsed = await parseReportFile(file);
    if (!parsed.type) throw new Error(`"${parsed.name}" ফাইলটি কোন রিপোর্ট বোঝা যায়নি।`);
    if (parsed.type === 'member') throw new Error('সদস্য তালিকা আর আপলোড করতে হবে না—কিস্তির তালিকা ও পূর্বের স্থিতি দিন।');
    misSlots[parsed.type] = { ...parsed, slot: parsed.type };
    renderMisSlots();
    if (status) status.innerHTML = `📄 <b>${esc(parsed.name)}</b> পড়া হয়েছে — ${esc(MIS_FORMAT_LABEL[parsed.format] || parsed.format)} · ${esc(MIS_SLOT_LABEL[parsed.type])}।`;
  } catch (e) {
    if (status) status.innerHTML = `⚠️ ${esc(e.message)}`;
  }
}
/* কিস্তি + balance আপডেট করে active-only contact Neon-এ সেভ */
async function applyMisFiles() {
  if (!requireAdminOnline()) return;
  const rules = window.COLLECTION_CSV;
  const status = $('#mis-upload-status');
  const btn = $('#btn-apply-mis-files');
  const done = [];
  btn.disabled = true;
  btn.textContent = '⏳ আপলোড হচ্ছে…';
  try {
    /* মাসের rows বদলানোর আগে পুরোনো আদায় স্থায়ী আর্কাইভে নিন। */
    archiveCurrentPaidInstallments();
    if (misSlots.installment) {
      const parsed = rules.parseInstallmentRows(misSlots.installment.rows);
      state.headers = parsed.headers;
      state.rows = parsed.rows;
      state.detect = detectColumns(parsed.headers);
      reconcilePaidArchiveBeforeReportReplace();
      state.filters = { staff: '', center: '', member: '', searchBy: 'memberCode', date: '', followup: '', followupDate: '' };
      ['f-staff', 'f-center', 'f-member', 'f-search-key', 'f-date', 'f-followup', 'f-followup-date'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
      $('#f-search-key').value = 'memberCode';
      updateInstallmentSearchMode(false);
      done.push(`① কিস্তির তালিকা — ${fmt(parsed.rows.length)} সারি`);
    }
    if (misSlots.balance) {
      const parsed = rules.parseBalanceRows(misSlots.balance.rows);
      state.balanceHeaders = parsed.headers;
      state.balanceRows = parsed.rows;
      done.push(`② পূর্বের স্থিতি — ${fmt(parsed.stats.members)} জন (${fmt(parsed.stats.records)} সারি থেকে)`);
    }
    if (!done.length) throw new Error('আপলোডের জন্য কোনো ফাইল নেই।');
    const pruned = pruneMemberDBToActive({ markForSync: true });
    if (pruned?.removed) done.push(`সক্রিয় কল/details — ${fmt(pruned.after)} জন · ${fmt(pruned.removed)} জনের bulk data বাদ`);
    /* নতুন রিপোর্টের আদায়ও যোগ হয়; পুরোনো key আবার যোগ হয় না। */
    archiveCurrentPaidInstallments();
    await persistRows({ allowOffline: false });
    populateFilters();
    renderAll();
    renderToday();
    renderMemberDatabaseTable();
    status.innerHTML = `✅ আপলোড সম্পন্ন — ${done.join(' · ')}।<br>সব ডিভাইসে নতুন ডেটা পাওয়া যাবে।`;
    toast('✅ ফাইল আপলোড হয়েছে — সব ডেটাবেজ আপডেট');
  } catch (e) {
    status.innerHTML = `⚠️ ${esc(e.message)}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆️ ফাইলগুলো আপলোড করে ডেটাবেজ আপডেট করুন';
    renderMisSlots();
  }
}
function closeAppMenu() {
  const panel = $('#app-menu-panel'), button = $('#btn-app-menu');
  panel?.classList.add('hidden');
  if (button) { button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'মেনু খুলুন'); }
}
function renderActivePage() {
  if (state.activePage === 'today') {
    renderToday();
    renderHistory();
  } else {
    renderTables();
    if (state.activePage === 'balance-directory') renderBalanceDirectory();
  }
}
function showPage(page, silent = false, alreadyRendered = false) {
  hideTodaySuggestions();
  const requested = String(page || 'today');
  const valid = requested === 'today' || requested === 'installments' || SECTION_KEYS.includes(requested);
  state.activePage = valid ? requested : 'today';
  state.sectionView = SECTION_KEYS.includes(state.activePage) ? state.activePage : 'all';
  const sectionSelect = $('#section-view-filter');
  if (sectionSelect && [...sectionSelect.options].some((option) => option.value === state.sectionView)) sectionSelect.value = state.sectionView;
  const balancePage = state.activePage === 'balance-directory';
  const promiseOption = $('#f-search-key option[value="promiseDate"]');
  if (promiseOption) { promiseOption.hidden = balancePage; promiseOption.disabled = balancePage; }
  if (balancePage && state.filters.searchBy === 'promiseDate') {
    state.filters.searchBy = 'memberCode';
    if ($('#f-search-key')) $('#f-search-key').value = 'memberCode';
    updateInstallmentSearchMode(false);
  }
  if (!alreadyRendered) renderActivePage();
  const today = state.activePage === 'today';
  $('#installment-page').classList.toggle('hidden', today);
  $('#today-page').classList.toggle('hidden', !today);
  $$('[data-menu-page]').forEach((button) => button.classList.toggle('active', button.dataset.menuPage === state.activePage));
  closeAppMenu();
  if (!silent) saveUiState();
}

function updateModalScrollLock() {
  const open = $$('.modal-overlay').some((overlay) => !overlay.classList.contains('hidden'));
  document.body.classList.toggle('modal-open', open);
}

function openNativeDatePicker(input) {
  if (!input) return;
  if (typeof input.showPicker === 'function') {
    try { input.showPicker(); } catch { input.focus(); }
  } else {
    input.focus();
  }
}

function identityValue(role, staff = '') { return `${role}|${encodeURIComponent(staff)}`; }
function renderIdentityOptions() {
  const select = $('#identity-select'); if (!select) return;
  const previous = select.value || identityValue(effectiveRole(), selectedStaffName());
  const names = staffNames();
  if (selectedStaffName() && !names.includes(selectedStaffName())) names.push(selectedStaffName());
  select.innerHTML = '<option value="">— নির্বাচন করুন —</option>'
    + names.map((name) => `<option value="${identityValue('staff', name)}">👤 ${esc(name)}</option>`).join('')
    + `<option value="${identityValue('manager')}">🛡️ Manager — সব ডেটা শুধু দেখা</option>`
    + `<option value="${identityValue('admin')}">⚙️ Admin — সব কাজ</option>`;
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}
function showIdentityGate() {
  renderIdentityOptions(); updateSyncStatus();
  $('#identity-screen')?.classList.remove('hidden');
}
function hideIdentityGate() { $('#identity-screen')?.classList.add('hidden'); }
function applyIdentityAccess() {
  const role = effectiveRole(), staff = selectedStaffName();
  document.body.classList.toggle('role-staff', role === 'staff');
  document.body.classList.toggle('role-manager', role === 'manager');
  document.body.classList.toggle('role-admin', role === 'admin');
  if (staff) { state.filters.staff = staff; if ($('#f-staff')) $('#f-staff').value = staff; }
  $$('[data-admin-only]').forEach((element) => element.classList.toggle('role-hidden', role !== 'admin'));
  const badge = $('#identity-badge'); if (badge) badge.textContent = staff || roleLabel(role);
  const switchButton = $('#btn-switch-identity');
  if (switchButton) switchButton.title = `${staff || roleLabel(role)} · নাম / ভূমিকা বদলান`;
  updateSyncStatus();
}
function selectIdentity() {
  const select = $('#identity-select');
  const value = select?.value || '';
  if (!value) { $('#identity-status').textContent = 'আগে একটি নাম বা ভূমিকা নির্বাচন করুন।'; return; }
  const separator = value.indexOf('|');
  const role = value.slice(0, separator);
  const staff = role === 'staff' ? decodeURIComponent(value.slice(separator + 1)) : '';
  if (!['staff', 'manager', 'admin'].includes(role)) return;
  /* এক ব্যবহারকারীর অসম্পূর্ণ edit অন্য নাম/role-এর নিচে চলে যাবে না। */
  cancelTodayEdit(true);
  state.identity = { role, staff, label: staff || roleLabel(role) };
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(state.identity)); } catch {}
  state.filters.staff = staff; state.filters.center = ''; state.filters.member = '';
  if (!staff && $('#f-staff')) $('#f-staff').value = '';
  if ($('#f-center')) $('#f-center').value = '';
  if ($('#f-member')) $('#f-member').value = '';
  directoryOptionsCache.key = '';
  applyIdentityAccess(); populateFilters(); renderAll(); hideIdentityGate();
  toast(`✅ ${staff || roleLabel(role)} হিসেবে প্রবেশ করেছেন`);
}

function renderHeader() {
  $('#repo-badge').textContent = `👤 ${selectedStaffName() || roleLabel()} · Neon · ${APP_VER} · বাংলা`;
  $('#sync-status').textContent = !state.isOnline
    ? `📴 অফলাইন · স্থানীয় ডেটা${state.outbox.length ? ` · ${fmt(state.outbox.length)}টি operation বাকী` : ''}`
    : state.outbox.length ? `⏳ ${fmt(state.outbox.length)}টি operation sync বাকী`
    : state.lastSync ? `সিঙ্ক হয়েছে ${state.lastSync.toLocaleTimeString('bn-BD')}` : 'সিঙ্ক হয়নি';
  renderIdentityOptions();
}

function renderAll() {
  applyIdentityAccess();
  renderHeader();
  renderActivePage();
  showPage(state.activePage, true, true);
}

function populateFilters() {
  const d = state.detect;
  const fillSelect = (itemSel, selEl, idx, allLabel, labeler, extraValues = []) => {
    const item = $(itemSel);
    if (idx < 0) { item.classList.add('hidden'); return; }
    item.classList.remove('hidden');
    const vals = sortAZ([...new Set([...visibleRows.map((r) => String(r[idx] ?? '').trim()), ...extraValues].filter(Boolean))]);
    const cur = selEl.value;
    selEl.innerHTML = `<option value="">${allLabel}</option>` +
      vals.map((v) => `<option value="${esc(v)}">${esc(labeler ? labeler(v) : v)}</option>`).join('');
    if ([...selEl.options].some((o) => o.value === cur)) selEl.value = cur;
  };

  // ষ্টাফ ফিল্টার: নাম দিয়ে (না থাকলে কোড দিয়ে); সেন্টার তালিকা নির্বাচিত স্টাফ অনুযায়ী সীমিত।
  const staffIdx = d.staffName >= 0 ? d.staffName : d.staff;
  const visibleRows = state.rows.filter(rowBelongsToSelectedStaff);
  const archivedStaff = state.paidArchive.filter((item) => !selectedStaffName() || norm(item?.staffName || staffForMemberCode(item?.memberCode, item?.centerCode)) === norm(selectedStaffName())).map((item) => String(item?.staffName || '').trim()).filter(Boolean);
  fillSelect('#fi-staff', $('#f-staff'), staffIdx, 'সব ষ্টাফ', null, archivedStaff);
  if (selectedStaffName()) $('#f-staff').value = selectedStaffName();
  const selectedStaff = selectedStaffName() || $('#f-staff').value;
  const centerItem = $('#fi-center');
  const centerSelect = $('#f-center');
  if (d.centerCode < 0) {
    centerItem.classList.add('hidden');
    centerSelect.innerHTML = '<option value="">সব সেন্টার</option>';
  } else {
    centerItem.classList.remove('hidden');
    const eligibleRows = selectedStaff && staffIdx >= 0
      ? visibleRows.filter((row) => norm(row[staffIdx]) === norm(selectedStaff))
      : visibleRows;
    const centers = sortAZ([...new Set(eligibleRows.map((row) => String(row[d.centerCode] ?? '').trim()).filter(Boolean))]);
    const previousCenter = centerSelect.value;
    const shortLabels = new Map();
    centers.forEach((value) => {
      const short = displayCenterCode(value);
      shortLabels.set(value, (shortLabels.get(short) || 0) + 1);
    });
    centerSelect.innerHTML = '<option value="">সব সেন্টার</option>'
      + centers.map((value) => {
        const short = displayCenterCode(value);
        const label = shortLabels.get(short) > 1 ? value : short;
        return `<option value="${esc(value)}">${esc(label)}</option>`;
      }).join('');
    centerSelect.value = centers.some((value) => norm(value) === norm(previousCenter)) ? previousCenter : '';
  }
  state.filters.staff = $('#f-staff').value;
  state.filters.center = $('#f-center').value;
  $('#fi-member').classList.toggle('hidden', d.memberCode < 0 && d.memberName < 0);
  $('#fi-date').classList.toggle('hidden', d.date < 0);
}

/* ---------------- CSV আপলোড ফ্লো ---------------- */
function handleCSVFile(file) {
  if (!requireAdminOnline()) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      const delim = detectDelimiter(text.split(/\r?\n/)[0] || '');
      const parsed = parseCSV(text, delim);
      if (parsed.length < 2) throw new Error('CSV-তে হেডার ও অন্তত ১ সারি দরকার।');
      const headers = parsed[0].map((h) => h.trim());
      const rows = parsed.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').toString().trim()));
      const detect = detectColumns(headers);
      state.csvData = { headers, rows, detect };

      $('#csv-detect').innerHTML = `<b>✅ অটো-শনানো কলাম:</b><br>` +
        DETECT_LABELS.map(([k, label]) => {
          const idx = detect[k];
          return idx >= 0
            ? `${label}: <b>${esc(headers[idx])}</b>`
            : `${label}: <span class="miss">পাওয়া যায়নি</span>`;
        }).join('<br>');

      $('#csv-preview-wrap').classList.remove('hidden');
      $('#csv-preview thead').innerHTML = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
      $('#csv-preview tbody').innerHTML = rows.slice(0, 5)
        .map((r) => `<tr>${r.map((v, i) => `<td>${esc(i === detect.memberCode ? displayMemberCode(v) : v)}</td>`).join('')}</tr>`).join('');

      const errEl = $('#csv-error');
      if (detect.actual < 0) {
        errEl.textContent = '⚠️ CSV-তে "InstallmentActual" কলাম খুঁজে পাইনি। ফাইলটা ঠিক কিনা দেখুন — সমস্যা হলে ফাইলটা আমাকে পাঠান।';
        errEl.classList.remove('hidden');
        $('#btn-apply-csv').disabled = true;
      } else {
        if (detect.amount < 0) {
          errEl.textContent = '⚠️ "InstallmentAmount" কলাম পাইনি — সব আদায়কে সম্পূর্ণ আদায় ধরা হবে (আংশিক চিনতে পারবে না)।';
          errEl.classList.remove('hidden');
        } else {
          errEl.classList.add('hidden');
        }
        $('#btn-apply-csv').disabled = false;
      }
    } catch (e) {
      showCSVError(e.message);
      $('#btn-apply-csv').disabled = true;
      $('#csv-preview-wrap').classList.remove('hidden');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function showCSVError(msg) {
  const el = $('#csv-error');
  el.textContent = '⚠️ ' + msg;
  el.classList.remove('hidden');
}

async function applyCSV() {
  if (!requireAdminOnline()) return;
  const { headers, rows, detect } = state.csvData;
  const btn = $('#btn-apply-csv');
  btn.disabled = true;
  btn.textContent = '⏳ তৈরি হচ্ছে...';

  archiveCurrentPaidInstallments();
  state.headers = headers;
  state.rows = rows;
  state.detect = detect;
  reconcilePaidArchiveBeforeReportReplace();
  archiveCurrentPaidInstallments();
  state.filters = { staff: '', center: '', member: '', searchBy: 'memberCode', date: '', followup: '', followupDate: '' };
  $('#f-staff').value = ''; $('#f-center').value = ''; $('#f-member').value = ''; $('#f-search-key').value = 'memberCode'; $('#f-date').value = ''; $('#f-followup').value = ''; $('#f-followup-date').value = '';
  updateInstallmentSearchMode(false);

  populateFilters();
  renderAll();
  $('#csv-modal').classList.add('hidden');
  updateModalScrollLock();

  const c = countByStatus(rows);
  toast(`✅ ${fmt(rows.length)} সারি — বাকী ${fmt(c.due)} · আদায় ${fmt(c.paid)} · আংশিক ${fmt(c.partial)}`);

  btn.textContent = '📊 টেবিল দেখুন';
  btn.disabled = false;
  try {
    await persistRows({ allowOffline: false });
  } catch (e) {
    toast('সেভ সমস্যা: ' + e.message, true);
  }
}

/* ---------------- Neon access setup ---------------- */
function showSetup() {
  if (!canUpdateDatabase()) { toast('সেটিংস ও database control শুধু Admin-এর জন্য।', true); return; }
  $('#setup-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#set-refresh').value = settings.refreshSec;
  $('#set-autorefresh').checked = settings.autoRefresh;
}

function readSetupForm() {
  settings.mode = 'neon';
  settings.refreshSec = Math.max(8, Math.min(3600, num($('#set-refresh').value) || 10));
  settings.autoRefresh = $('#set-autorefresh').checked;
}

let syncTimer = null;
/* মেটা বদলেছে কি না দেখে তবেই পুরো ডাটা আনি — অন্য ডিভাইসের এন্ট্রি ১০ সেকেন্ডে দেখা যাবে */
async function syncIfChanged(force = false) {
  if (!state.isOnline) { updateSyncStatus(); return false; }
  try {
    const sent = await flushOutbox();
    if (sent || state.needsCanonicalSync) force = true;
    const meta = await neonMeta();
    if (!meta) { if (force) await loadDB(true); return false; }
    if (!force && meta.updated_at && state.serverUpdatedAt && meta.updated_at === state.serverUpdatedAt) return false;
    await loadDB(true);
    return true;
  } catch { updateSyncStatus(); return false; }
}
function restartSyncTimer() {
  clearInterval(syncTimer);
  if (!settings.autoRefresh) return;
  const seconds = Math.max(8, Math.min(Number(settings.refreshSec) || META_POLL_SEC, META_POLL_SEC));
  syncTimer = setInterval(async () => {
    if (document.hidden || !state.isOnline) return;       // ব্যাকগ্রাউন্ডে নেটওয়ার্ক খরচ নয়
    await syncIfChanged();
  }, seconds * 1000);
}

/* ফোন কল / অন্য অ্যাপ থেকে ফিরে এলে: রিলোড নয় — শুধু নিঃশব্দে সিঙ্ক */
let resumedAt = 0;
async function resumeFromBackground() {
  if (Date.now() - resumedAt < 3000) return;
  resumedAt = Date.now();
  const hadDraft = restoreTodayDraft();
  await syncIfChanged();
  if (!hadDraft) renderTodayBalanceCard();
  saveUiState();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeFromBackground();
  else saveUiState();
});
window.addEventListener('pageshow', (event) => { if (event.persisted) resumeFromBackground(); });
window.addEventListener('pagehide', saveUiState);
window.addEventListener('offline', () => { state.isOnline = false; updateSyncStatus(); });
window.addEventListener('online', () => {
  state.isOnline = true; updateSyncStatus();
  const pending = state.outbox.length;
  syncIfChanged(true).then(() => { if (pending) toast(`✅ Internet ফিরেছে—${fmt(pending)}টি operation sync হয়েছে`); }).catch(() => {});
});

/* সেভ চলছে বোঝানোর ছোট সংকেত */
function markSaving(on) {
  const dot = $('#sync-dot');
  const status = $('#sync-status');
  if (dot) dot.classList.toggle('saving', Boolean(on));
  if (status && on) status.textContent = 'সেভ হচ্ছে…';
  else if (status && !on && (!state.isOnline || state.outbox.length)) updateSyncStatus();
  else if (status && !on && state.lastSync) status.textContent = `সিঙ্ক হয়েছে ${state.lastSync.toLocaleTimeString('bn-BD')}`;
}

async function startApp() {
  $('#setup-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#sync-dot').className = 'dot';
  /* আগের বার-এর ডাটা লোকাল ক্যাশে থাকলে সাথে সাথে দেখাই — খোলার সময় লাগবে না */
  const cached = readFullDocCache();
  if (cached) {
    state.headers = Array.isArray(cached.headers) ? cached.headers : [];
    state.rows = Array.isArray(cached.rows) ? cached.rows : [];
    state.collections = Array.isArray(cached.collections) ? cached.collections : [];
    state.followups = Array.isArray(cached.followups) ? cached.followups : [];
    state.history = Array.isArray(cached.history) ? cached.history : [];
    if (cached.dailyData) applyDailyData(cached.dailyData);
    state.detect = detectColumns(state.headers);
    state.savedDoc = cached;
    pruneMemberDBToActive();
    state.lastSync = cached.updated_at ? new Date(cached.updated_at) : null;
    state.serverUpdatedAt = cached.updated_at || null;
    saveFullDocCache(buildDocument());
    populateFilters();
    renderAll();
    restoreTodayDraft();
    restoreUiState();
    if ($('#sync-status')) $('#sync-status').textContent = 'ক্যাশ থেকে দেখাচ্ছে · সিঙ্ক হচ্ছে…';
  }
  try {
    await loadDB(Boolean(cached));
  } catch (e) {
    $('#sync-status').textContent = 'সিঙ্ক এরর: ' + e.message;
    $('#sync-dot').classList.add('err');
    toast('ডাটা লোড করতে সমস্যা: ' + e.message, true);
    renderAll();
    return;
  }
  $('#sync-dot').classList.add(state.isOnline ? 'ok' : 'offline');
  /* প্রথমবার v9.16 খোলার সময় বর্তমান রিপোর্টের আদায় archive-এ migrate হয়। */
  archiveCurrentPaidInstallments();
  const archiveNeedsSave = JSON.stringify(state.savedDoc?.dailyData?.paidArchive || []) !== JSON.stringify(state.paidArchive);
  const staffDirectoryNeedsSave = JSON.stringify(state.savedDoc?.dailyData?.staffDirectory || []) !== JSON.stringify(state.staffDirectory);
  populateFilters();
  collapseAllSections();
  renderAll();
  restoreTodayDraft();
  restoreUiState();
  if (archiveNeedsSave || staffDirectoryNeedsSave) {
    try { await persistRows(); }
    catch (e) { toast('⚠️ আদায় আর্কাইভ/ষ্টাফ তালিকা সেভ হয়নি: ' + e.message, true); }
  }
  restartSyncTimer();
}

/* ---------------- Events ---------------- */
function bindEvents() {
  $('#btn-enter-identity')?.addEventListener('click', selectIdentity);
  $('#identity-select')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') selectIdentity(); });
  $('#btn-switch-identity')?.addEventListener('click', showIdentityGate);
  // হেডার বাটন
  $('#btn-refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin');
    try { await loadDB(); $('#sync-dot').classList.add('ok'); populateFilters(); renderAll(); toast('🔄 রিফ্রেশ সম্পন্ন'); }
    catch (err) { toast('রিফ্রেশ ব্যর্থ: ' + err.message, true); }
    btn.classList.remove('spin');
  });
  const openUpload = () => {
    if (!requireAdminOnline()) return;
    $('#csv-modal').classList.remove('hidden');
    updateModalScrollLock();
    $('#csv-preview-wrap').classList.add('hidden');
    $('#csv-error').classList.add('hidden');
    $('#btn-apply-csv').disabled = true;
    $('#csv-file').value = '';
  };
  $('#btn-upload')?.addEventListener('click', openUpload);  // হেডারের বাটন বাদ দেওয়া হয়েছে
  $('#btn-upload-2').addEventListener('click', openUpload);
  $('#btn-settings').addEventListener('click', showSetup);

  // নিচে ডান দিকের three-line menu → আলাদা table pages
  $('#btn-app-menu')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const panel = $('#app-menu-panel'), button = $('#btn-app-menu');
    const opening = panel?.classList.contains('hidden');
    panel?.classList.toggle('hidden', !opening);
    if (button) { button.setAttribute('aria-expanded', String(Boolean(opening))); button.setAttribute('aria-label', opening ? 'মেনু বন্ধ করুন' : 'মেনু খুলুন'); }
  });
  $$('[data-menu-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.menuPage)));
  document.addEventListener('click', (event) => { if (!event.target.closest('.app-menu-shell')) closeAppMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAppMenu(); });
  $('#btn-add-today').addEventListener('click', addTodayRow);
  const cancelEditBtn = $('#btn-cancel-edit');
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => cancelTodayEdit());
  // ↻ রিসেট = শুধু এন্ট্রি ঘরগুলো ফাঁকা করে; তালিকা, কিস্তি, খাতা — কিছুই বদলায় না
  $('#btn-reset-today').addEventListener('click', () => {
    clearTodayForm();
    toast('✅ এন্ট্রি ঘরগুলো ফাঁকা হয়েছে');
  });
  // ✔️ হিসাব ক্লোজ — আজকের সব এন্ট্রি তারিখভিত্তিক স্থায়ী খাতায় জমা হয় (কিস্তির অঙ্ক অপরিবর্তিত)
  $('#btn-close-today').addEventListener('click', closeTodayAccount);
  $('#history-date').addEventListener('change', renderHistory);
  $('#history-list')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-history]');
    if (editBtn) { e.stopPropagation(); startEditHistory(editBtn.dataset.editHistory); return; }
    const delBtn = e.target.closest('[data-del-history]');
    if (delBtn) { e.stopPropagation(); deleteHistoryRow(delBtn.dataset.delHistory); return; }
  });
  $('#btn-clear-history-date').addEventListener('click', () => { $('#history-date').value=''; renderHistory(); });

  /* স্থায়ী আদায় আর্কাইভ: মাস অথবা নির্দিষ্ট আদায়ের তারিখ */
  $('#paid-archive-month')?.addEventListener('change', () => {
    if ($('#paid-archive-date')) $('#paid-archive-date').value = '';
    renderPaidArchive();
  });
  $('#paid-archive-date')?.addEventListener('change', () => {
    if ($('#paid-archive-month')) $('#paid-archive-month').value = '';
    renderPaidArchive();
  });
  $('#btn-clear-paid-archive')?.addEventListener('click', () => {
    if ($('#paid-archive-month')) $('#paid-archive-month').value = '';
    if ($('#paid-archive-date')) $('#paid-archive-date').value = '';
    renderPaidArchive();
  });

  $('#btn-member-db').addEventListener('click', () => { if (!requireAdminOnline()) return; $('#member-csv-status').textContent = state.memberDB.length ? `বর্তমানে ${fmt(state.memberDB.length)} সক্রিয় সদস্যের compact কল/details আছে।` : 'কিস্তির তালিকা ও পূর্বের স্থিতি আপলোড করুন।'; $('#member-csv-modal').classList.remove('hidden'); updateModalScrollLock(); });
  $('#btn-open-member-table').addEventListener('click', () => { renderMemberDatabaseTable(); $('#member-db-table-modal').classList.remove('hidden'); updateModalScrollLock(); });
  $('#member-db-code-search').addEventListener('input', renderMemberDatabaseTable);
  $('#member-db-center-search').addEventListener('input', renderMemberDatabaseTable);
  $('#balance-filter-all')?.addEventListener('change', () => {
    if ($('#balance-search-all')) $('#balance-search-all').value = '';
    renderBalanceDirectory();
  });
  $('#balance-search-all')?.addEventListener('input', () => {
    if ($('#balance-filter-all')) $('#balance-filter-all').value = '';
    renderBalanceDirectory();
  });
  $('#btn-clear-balance-directory')?.addEventListener('click', () => {
    if ($('#balance-filter-all')) $('#balance-filter-all').value = '';
    if ($('#balance-search-all')) $('#balance-search-all').value = '';
    renderBalanceDirectory();
  });
  $('#member-db-list').addEventListener('click', (event) => { const row=event.target.closest('[data-member-db-index]'); if(row) openDirectoryMemberDetails(Number(row.dataset.memberDbIndex)); });
  $('#member-db-list').addEventListener('keydown', (event) => { if(event.key==='Enter'||event.key===' '){const row=event.target.closest('[data-member-db-index]');if(row){event.preventDefault();openDirectoryMemberDetails(Number(row.dataset.memberDbIndex));}} });
  $('#balance-csv-file').addEventListener('change', (e) => { if(e.target.files[0]) importBalanceCSV(e.target.files[0]); e.target.value=''; });
  $('#member-csv-file').addEventListener('change', (e) => { if(e.target.files[0]) importMemberCSV(e.target.files[0]); e.target.value=''; });
  // একসাথে দুটি ফাইল আপলোড
  $('#btn-pick-mis-all')?.addEventListener('click', () => $('#mis-files-all')?.click());
  $('#mis-files-all')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) await handleMisFile(file);
  });
  ['installment', 'balance'].forEach((slot) => {
    $('#btn-pick-mis-' + slot)?.addEventListener('click', () => $('#mis-file-' + slot)?.click());
    $('#mis-file-' + slot)?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) await handleMisFile(file);
    });
  });
  $('#btn-apply-mis-files')?.addEventListener('click', applyMisFiles);
  /* কিছু phone/WebView-এ :focus indicator দুর্বল দেখায়। Focus event থেকে
     একটি বাড়তি class দিই—typing যেখানে চলছে সেই field স্পষ্ট থাকে। */
  const todayEntryGrid = $('.today-entry-grid');
  if (todayEntryGrid) {
    todayEntryGrid.addEventListener('focusin', (event) => {
      const input = event.target.closest('input');
      if (!input) return;
      input.classList.add('input-focus-active');
      input.closest('.field')?.classList.add('field-focus-active');
    });
    todayEntryGrid.addEventListener('focusout', (event) => {
      const input = event.target.closest('input');
      if (!input) return;
      input.classList.remove('input-focus-active');
      input.closest('.field')?.classList.remove('field-focus-active');
    });
  }
  $('#today-member-code').addEventListener('input', fillTodayMember);
  $('#today-member-code').addEventListener('change', fillTodayMember);
  // লোন/সঞ্চয়/DPS/মোট—যেকোনো তিনটি পূরণ হলে চতুর্থটি অটো; স্থিতি কার্ডও লাইভ হিসাব হয়।
  TODAY_AMOUNT_KEYS.forEach((key) => {
    const sel = '#today-' + key;
    $(sel).addEventListener('input', () => {
      if (key === 'loan') $(sel).dataset.autofill = '0';
      autoCalculateTodayAmounts(key);
      renderTodayBalanceCard();
    });
    $(sel).addEventListener('change', renderTodayBalanceCard);
  });
  $('#today-member-name').addEventListener('change', fillTodayMemberByName);
  bindTodaySuggestionInput('code');
  bindTodaySuggestionInput('name');
  /* টাইপ করার সাথে সাথে খসড়া সংরক্ষণ — কল/বন্ধ হলেও ফিরে এসে একই জায়গায় */
  ['#today-member-code', '#today-center-code', '#today-member-name', '#today-loan', '#today-savings', '#today-dps', '#today-total']
    .forEach((sel) => {
      $(sel)?.addEventListener('input', saveTodayDraft);
      $(sel)?.addEventListener('change', saveTodayDraft);
    });
  let scrollSaveTimer = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(saveUiState, 400);
  }, { passive: true });
  ['#today-monthly-list', '#today-other-list'].forEach((sel) => {
    const body = $(sel); if (!body) return;
    body.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-today]');
      if (editBtn) { e.stopPropagation(); startEditToday(Number(editBtn.dataset.editToday)); return; }
      const delBtn = e.target.closest('[data-del-today]');
      if (delBtn) { e.stopPropagation(); deleteTodayRow(Number(delBtn.dataset.delToday)); return; }
      const row=e.target.closest('[data-today-index]'); if(row) openTodayDetails(Number(row.dataset.todayIndex));
    });
    body.addEventListener('keydown', (e) => { if(e.key==='Enter'||e.key===' '){ const row=e.target.closest('[data-today-index]'); if(row){e.preventDefault();openTodayDetails(Number(row.dataset.todayIndex));}} });
  });

  // ফিল্টার
  $('#f-staff').addEventListener('change', (e) => {
    state.filters.staff = e.target.value;
    // Installment page-এ staff বদলালে center options সীমিত হয়; balance page নিজের staff/center options রাখে।
    if (state.activePage !== 'balance-directory') populateFilters();
    renderActivePage();
  });
  $('#f-center').addEventListener('change', (e) => { state.filters.center = e.target.value; renderActivePage(); });
  $('#f-member').addEventListener('input', (e) => {
    const numericMode = ['memberCode', 'centerCode'].includes(state.filters.searchBy);
    if (numericMode) {
      const english = toEn(e.target.value);
      if (english !== e.target.value) e.target.value = english;
    }
    state.filters.member = e.target.value.trim();
    renderActivePage();
  });
  $('#f-member').addEventListener('change', (e) => { state.filters.member = e.target.value.trim(); renderActivePage(); });
  $('#f-search-key').addEventListener('change', () => { updateInstallmentSearchMode(); renderActivePage(); });
  $('#section-view-filter')?.addEventListener('change', (e) => { showPage(e.target.value === 'all' ? 'installments' : e.target.value); });
  $('#f-date').addEventListener('change', (e) => { state.filters.date = e.target.value; renderTables(); });
  $('#f-followup').addEventListener('input', (e) => { state.filters.followup = e.target.value.trim(); renderTables(); });
  $('#f-followup-date').addEventListener('change', (e) => { state.filters.followupDate = e.target.value; renderTables(); });
  $('#btn-clear-filters').addEventListener('click', () => {
    state.filters = { staff: '', center: '', member: '', searchBy: 'memberCode', date: '', followup: '', followupDate: '' };
    $('#f-staff').value = ''; $('#f-center').value = ''; $('#f-member').value = ''; $('#f-search-key').value = 'memberCode'; $('#f-date').value = ''; $('#f-followup').value = ''; $('#f-followup-date').value = '';
    updateInstallmentSearchMode(false);
    populateFilters();
    renderActivePage();
    toast('✖ ফিল্টার মুছে ফেলা হয়েছে');
  });

  const activateBalanceRow = (target) => {
    const row = target.closest?.('.balance-directory-row');
    if (row?.dataset.balanceRowIndex != null) openBalanceMemberDetails(row.dataset.balanceRowIndex);
  };
  $('#balance-directory-list')?.addEventListener('click', (e) => activateBalanceRow(e.target));
  $('#balance-directory-list')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateBalanceRow(e.target); }
  });
  $('#member-collection-action')?.addEventListener('click', (e) => { if (e.target.closest('#btn-collect-from-balance')) startBalanceCollection(); });
  $('#btn-return-page')?.addEventListener('click', () => {
    const target = state.todayReturnPage || 'balance-directory';
    state.todayReturnPage = '';
    $('#btn-return-page').classList.add('hidden');
    showPage(target);
  });

  // চিপস → সেকশনে স্ক্রল
  [['chip-due', 'sec-due'], ['chip-paid', 'sec-paid'], ['chip-partial', 'sec-partial']].forEach(([chip, sec]) => {
    $('#' + chip).addEventListener('click', () => {
      const page = sec.replace(/^sec-/, '');
      showPage(page);
      const el = $('#' + sec);
      expandSection(sec);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // কোল্যাপস
  $$('.table-head').forEach((h) => h.addEventListener('click', () => {
    $('#' + h.dataset.collapse).classList.toggle('collapsed');
  }));

  // মডাল বন্ধ
  const closeModal = (overlay) => {
    if (overlay) overlay.classList.add('hidden');
    updateModalScrollLock();
  };
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal($('#' + button.dataset.close))));
  $$('.modal-overlay').forEach((overlay) => overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal(overlay);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const openOverlay = $$('.modal-overlay').find((overlay) => !overlay.classList.contains('hidden'));
      if (openOverlay) closeModal(openOverlay);
    }
  });

  // CSV
  $('#csv-file').addEventListener('change', (e) => { if (e.target.files[0]) handleCSVFile(e.target.files[0]); });
  $('#drop-zone').addEventListener('click', () => $('#csv-file').click());
  $('#drop-zone').addEventListener('dragover', (e) => { e.preventDefault(); $('#drop-zone').classList.add('dragover'); });
  $('#drop-zone').addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragover'));
  $('#drop-zone').addEventListener('drop', (e) => {
    e.preventDefault();
    $('#drop-zone').classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) handleCSVFile(f);
  });
  $('#btn-apply-csv').addEventListener('click', applyCSV);

  // সারি ক্লিক → সদস্যের তথ্য; 📝 → প্রতিশ্রুতি মডাল
  ['#tbl-today-promise', '#tbl-payable', '#tbl-due', '#tbl-paid', '#tbl-partial'].forEach((selector) => {
    if (!$(selector)) return;
    $(selector).addEventListener('click', (event) => {
      const followupButton = event.target.closest('[data-followup-index]');
      if (followupButton) {
        event.preventDefault();
        event.stopPropagation();
        openFollowupModal(Number(followupButton.dataset.followupIndex));
        return;
      }
      const row = event.target.closest('[data-row-index]');
      if (row) openMemberDetailsFromRow(Number(row.dataset.rowIndex));
    });
  });
  $('#btn-save-followup').addEventListener('click', saveFollowup);
  ['#f-date', '#f-followup-date', '#followup-date', '#history-date'].forEach((selector) => {
    const input = $(selector);
    input.addEventListener('click', () => openNativeDatePicker(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openNativeDatePicker(input);
    });
    const wrapper = input.closest('.filter-item, .date-field, .date-input-field');
    if (wrapper) wrapper.addEventListener('click', (event) => {
      if (event.target === input) return;
      if (event.target.closest('label')) event.preventDefault();
      openNativeDatePicker(input);
    });
  });

  // Public Neon API connection check and UI settings
  $('#btn-download-backup').addEventListener('click', downloadLocalBackup);
  $('#btn-test-conn').addEventListener('click', async () => {
    const errEl = $('#setup-error');
    errEl.classList.add('hidden');
    try {
      const document = await neonRead();
      toast(`✅ Neon সংযোগ সফল — ${fmt((document.rows || []).length)} সারি`);
    } catch (e) {
      errEl.textContent = '⚠️ ' + e.message;
      errEl.classList.remove('hidden');
    }
  });
  $('#btn-save-settings').addEventListener('click', () => {
    readSetupForm();
    saveSettings();
    $('#setup-screen').classList.add('hidden');
    startApp();
    toast('💾 সেটিংস সেভ হয়েছে');
  });
}

/* ---------------- কীবোর্ড খোলা অবস্থায় ঢিলেঢালা জায়গা কমানো ---------------- */
/* ফোনে কীবোর্ড খুললে হিসাবের কার্ড + এন্ট্রি ফর্ম + কীবোর্ড — একসাথে এক স্ক্রিনে দেখা যায় */
/* কার্ড + ফর্ম একসাথে স্ক্রিনে রাখতে কার্ডের মাথা থেকে দেখাই */
function keepEntryAreaVisible() {
  const card = $('#today-balance-summary');
  const form = $('#today-page .today-entry-grid');
  if (!card || !form) return;
  requestAnimationFrame(() => {
    const top = card.getBoundingClientRect().top + window.scrollY - 4;
    try { window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch { window.scrollTo(0, Math.max(0, top)); }
  });
}
function syncKeyboardMode() {
  const vv = window.visualViewport;
  const keyboard = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
  const open = keyboard > 120;
  document.body.classList.toggle('kb-open', open);
  document.documentElement.style.setProperty('--keyboard-h', `${Math.round(keyboard)}px`);
  if (open) keepEntryAreaVisible();
}

/* ---------------- Init ---------------- */
bindEvents();
if (!localStorage.getItem(IDENTITY_KEY)) showIdentityGate();
else applyIdentityAccess();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* app shell cache unavailable হলেও local entry cache চলবে */ });
}
if (window.visualViewport) {
  const syncVisualViewport = () => {
    document.documentElement.style.setProperty('--visual-vh', `${window.visualViewport.height}px`);
    syncKeyboardMode();
  };
  window.visualViewport.addEventListener('resize', syncVisualViewport);
  window.visualViewport.addEventListener('scroll', syncVisualViewport);
  syncVisualViewport();
}
/* কিছু ব্রাউজার visualViewport ঠিকমতো না জানালেও ফোকাস দেখে বুঝে নিই */
const isSmallScreen = () => window.matchMedia('(max-width: 900px)').matches;
document.addEventListener('focusin', (event) => {
  if (isSmallScreen() && event.target.closest && event.target.closest('.today-entry-grid')) {
    document.body.classList.add('kb-open');
    document.body.classList.add('kb-entry');
    keepEntryAreaVisible();
  }
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || !active.closest || !active.closest('.today-entry-grid')) {
      document.body.classList.remove('kb-entry');
      syncKeyboardMode();
    }
  }, 120);
});
window.addEventListener('resize', syncKeyboardMode);
const appHeader = $('.app-header');
const syncStickyPageTabs = () => {
  const height = appHeader?.getBoundingClientRect().height || 88;
  document.documentElement.style.setProperty('--app-header-height', `${height}px`);
};
if (appHeader && 'ResizeObserver' in window) new window.ResizeObserver(syncStickyPageTabs).observe(appHeader);
window.addEventListener('resize', syncStickyPageTabs);
requestAnimationFrame(syncStickyPageTabs);
startApp();
