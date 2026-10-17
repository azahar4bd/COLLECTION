/* =========================================================
   কালেকশন ম্যানেজার — কিস্তি রিপোর্ট (CSV)
   - CSV অটো-ডিটেক্ট (কোনো সিলেকশন/ম্যাপিং নেই)
   - ৩ টেবিল: বাকী কিস্তি · আদায় কিস্তি · আংশিক কিস্তি
       · InstallmentActual = 0                  → বাকী
       · InstallmentActual <  InstallmentAmount → আংশিক
       · InstallmentActual >= InstallmentAmount → আদায়
   - ফিল্টার: ষ্টাফ · সেন্টার কোড · মেম্বার কোড · তারিখ
   - GitHub অথবা লোকাল (বিনা টোকেনে) স্টোরেজ
   ========================================================= */
'use strict';

/* ---------------- Utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]
));
const norm = (v) => String(v ?? '').trim().toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const BN_DIGIT = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const toEn = (s) => String(s ?? '').replace(/[০-৯]/g, (d) => BN_DIGIT[d]);
const num = (v) => {
  const n = parseFloat(toEn(String(v ?? '')).replace(/[৳,\sTk]/gi, ''));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};
const fmt = (n) => Number(n || 0).toLocaleString('bn-BD', { maximumFractionDigits: 2 });

const toISODate = (v) => {
  const s = toEn(String(v ?? '')).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // dd/mm/yyyy (বাংলাদেশ)
  return '';
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

/* ---------------- Settings (localStorage) ---------------- */
const SET_KEY = 'collectionManager.settings.v1';
const APP_VER = 'v4';
const AUTH_ERR = /401|Bad credentials/i;

const defaultSettings = () => ({
  mode: 'github', // 'github' | 'local' (লোকাল মোডে টোকেন লাগে না)
  token: '', owner: '', repo: '', branch: 'main',
  membersPath: 'data/installments.json',
  autoRefresh: true, refreshSec: 60,
});
let settings = { ...defaultSettings(), ...(JSON.parse(localStorage.getItem(SET_KEY) || '{}')) };
const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));

/* ---------------- Local mode (বিনা টোকেনে) ---------------- */
const isLocal = () => settings.mode === 'local';
const localKey = (p) => 'collectionManager.localDB.v1.' + p;

/* ---------------- GitHub API ---------------- */
const API = 'https://api.github.com';
const ghHeaders = () => ({
  Authorization: `Bearer ${settings.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});
const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const ghPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function ghReadFile(path) {
  if (isLocal()) {
    const text = localStorage.getItem(localKey(path));
    return text === null ? null : { sha: 'local', text };
  }
  const url = `${API}/repos/${settings.owner}/${settings.repo}/contents/${ghPath(path)}?ref=${encodeURIComponent(settings.branch)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  if (data.type !== 'file') throw new Error(`পাথটি একটি ফাইল নয়: ${path}`);
  return { sha: data.sha, text: b64decode(data.content) };
}

async function ghWriteFile(path, text, message) {
  if (isLocal()) {
    try {
      localStorage.setItem(localKey(path), text);
    } catch (e) {
      throw new Error('ব্রাউজার স্টোরেজ ভর্তি হয়ে গেছে — ফাইলটা সেভ হয়নি (তবে এখন দেখা যাবে)');
    }
    return { content: { path, sha: 'local' } };
  }
  const url = `${API}/repos/${settings.owner}/${settings.repo}/contents/${ghPath(path)}`;
  let sha = null;
  try { const cur = await ghReadFile(path); if (cur) sha = cur.sha; } catch { /* নতুন ফাইল */ }
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: b64encode(text), sha, branch: settings.branch }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 409) throw new Error('দ্বন্দ্ব: আবার চেষ্টা করুন (অন্য কেউ ডাটা পরিবর্তন করেছে)।');
    throw new Error(`GitHub ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

const persistFile = async (path, text, message) => {
  try {
    return await ghWriteFile(path, text, message);
  } catch (e) {
    if (!isLocal() && AUTH_ERR.test(e.message)) {
      settings.mode = 'local';
      saveSettings();
      toast('⚠️ GitHub টোকেন কাজ করছে না — লোকাল মোডে সেভ হলো');
      renderHeader();
      return await ghWriteFile(path, text, message);
    }
    throw e;
  }
};

const dataPath = () => settings.membersPath || 'data/installments.json';

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
    has(h, 'installment', 'actual') || has(h, 'instalment', 'actual') ? 100 :
    has(h, 'actualinstallment') ? 95 :
    h.includes('actual') ? 75 :
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
    has(h, 'installment', 'date') || has(h, 'instalment', 'date') ? 100 :
    has(h, 'due', 'date') ? 95 :
    has(h, 'paid', 'date') || has(h, 'payment', 'date') ? 90 :
    h.includes('date') ? 70 : 0);

  return { actual, amount, staff, centerCode, centerName, memberCode, memberName, date };
}

const DETECT_LABELS = [
  ['actual', 'আদায় (InstallmentActual)'],
  ['amount', 'কিস্তি (InstallmentAmount)'],
  ['staff', 'ষ্টাফ'],
  ['centerCode', 'সেন্টার কোড'],
  ['memberCode', 'মেম্বার কোড'],
  ['memberName', 'মেম্বার নাম'],
  ['date', 'তারিখ'],
  ['centerName', 'সেন্টার নাম'],
];

/* ---------------- App state ---------------- */
const state = {
  headers: [],          // CSV হেডার
  rows: [],             // [[cell, cell, ...], ...]
  detect: {},           // { actual, amount, staff, ... } → কলাম ইনডেক্স
  filters: { staff: '', center: '', member: '', date: '' },
  csvData: null,        // আপলোডের সময়ের কাজচলা কপি
  lastSync: null,
};

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

/* ---------------- লোড / সেভ ---------------- */
const loadDB = async (quiet = false) => {
  const f = await ghReadFile(dataPath());
  let headers = [], rows = [];
  if (f) {
    try {
      const j = JSON.parse(f.text);
      if (Array.isArray(j.headers) && Array.isArray(j.rows)) {
        headers = j.headers;
        rows = j.rows.filter((r) => Array.isArray(r));
      }
    } catch { /* ভাঙা/অপরিচিত ফাইল — খালি দেখাও */ }
  }
  const changed = JSON.stringify(state.rows) !== JSON.stringify(rows);
  state.headers = headers;
  state.rows = rows;
  state.detect = detectColumns(headers);
  state.lastSync = new Date();
  if (changed && quiet && rows.length) { renderAll(); toast('🔄 ডাটা আপডেট হয়েছে'); }
};

const persistRows = () =>
  persistFile(dataPath(), JSON.stringify({ updated_at: new Date().toISOString(), headers: state.headers, rows: state.rows }), 'installments: CSV update');

/* ---------------- ফিল্টার ---------------- */
function filteredRows() {
  const f = state.filters, d = state.detect;
  return state.rows.filter((r) => {
    if (f.staff && d.staff >= 0 && norm(r[d.staff]) !== norm(f.staff)) return false;
    if (f.center && d.centerCode >= 0 && norm(r[d.centerCode]) !== norm(f.center)) return false;
    if (f.member) {
      const q = norm(f.member);
      const code = d.memberCode >= 0 ? norm(r[d.memberCode]) : '';
      const name = d.memberName >= 0 ? norm(r[d.memberName]) : '';
      if (!code.includes(q) && !name.includes(q)) return false;
    }
    if (f.date && d.date >= 0) {
      const cell = String(r[d.date] ?? '');
      if (toISODate(cell) !== f.date && cell.trim() !== f.date) return false;
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
  add(d.staff, 'ষ্টাফ');
  add(d.date, 'তারিখ');
  add(d.amount, 'কিস্তি (৳)');
  add(d.actual, 'আদায় (৳)');
  cols.push({ idx: -1, label: 'বাকী (৳)', virtual: 'bal' });
  state.headers.forEach((h, i) => { if (!used.has(i)) cols.push({ idx: i, label: h }); });
  return cols;
}

const RENDER_CAP = 500;

function cellHTML(r, c) {
  const d = state.detect;
  if (c.virtual === 'bal') {
    const amt = d.amount >= 0 ? num(r[d.amount]) : 0;
    const act = num(r[d.actual]);
    return `<td class="amt">${fmt(Math.max(0, amt - act))}</td>`;
  }
  const v = r[c.idx] ?? '';
  if (c.idx === d.amount || c.idx === d.actual) return `<td class="amt">${fmt(num(v))}</td>`;
  return `<td>${esc(v)}</td>`;
}

function renderSection(key, rows) {
  const cols = tableColumns();
  const d = state.detect;
  const thead = $(`#table-${key} thead`);
  const tbody = $(`#tbl-${key}`);
  if (!thead || !tbody) return;

  thead.innerHTML = `<tr>${cols.map((c) => {
    const isAmt = c.virtual === 'bal' || c.idx === d.amount || c.idx === d.actual;
    return `<th class="${isAmt ? 'amt' : ''}">${esc(c.label)}</th>`;
  }).join('')}</tr>`;

  const shown = rows.slice(0, RENDER_CAP);
  tbody.innerHTML = shown.map((r) => `<tr>${cols.map((c) => cellHTML(r, c)).join('')}</tr>`).join('')
    + (rows.length > RENDER_CAP
      ? `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--muted)">… আরও ${fmt(rows.length - RENDER_CAP)} সারি — ফিল্টার দিয়ে খুঁজুন</td></tr>`
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
      <div class="total-box"><span>মোট কিস্তি</span><strong>৳ ${fmt(sumAmt)}</strong></div>
      <div class="total-box"><span>মোট আদায়</span><strong>৳ ${fmt(sumAct)}</strong></div>
      <div class="total-box"><span>মোট বাকী</span><strong>৳ ${fmt(sumBal)}</strong></div>
    </div>`;
}

function renderTables() {
  const rows = filteredRows();
  const groups = { due: [], paid: [], partial: [] };
  for (const r of rows) groups[rowStatus(r)].push(r);

  renderSection('due', groups.due);
  renderSection('paid', groups.paid);
  renderSection('partial', groups.partial);

  $('#chip-due strong').textContent = fmt(groups.due.length);
  $('#chip-paid strong').textContent = fmt(groups.paid.length);
  $('#chip-partial strong').textContent = fmt(groups.partial.length);

  const hasData = state.rows.length > 0;
  $('#no-data').classList.toggle('hidden', hasData);
  $$('[data-sec]').forEach((el) => el.classList.toggle('hidden', !hasData));
  $('#summary-chips').classList.toggle('hidden', !hasData);
}

function renderHeader() {
  $('#repo-badge').textContent = isLocal()
    ? `📱 লোকাল মোড · এই ব্রাউজারে সেভ হচ্ছে · ${APP_VER}`
    : `${settings.owner}/${settings.repo} · ${settings.branch} · ${APP_VER}`;
  $('#sync-status').textContent = state.lastSync
    ? `সিঙ্ক হয়েছে ${state.lastSync.toLocaleTimeString('bn-BD')}`
    : 'সিঙ্ক হয়নি';
}

function renderAll() {
  renderHeader();
  renderTables();
}

function populateFilters() {
  const d = state.detect;
  const fillSelect = (itemSel, selEl, idx, allLabel) => {
    const item = $(itemSel);
    if (idx < 0) { item.classList.add('hidden'); return; }
    item.classList.remove('hidden');
    const vals = [...new Set(state.rows.map((r) => String(r[idx] ?? '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'bn'));
    const cur = selEl.value;
    selEl.innerHTML = `<option value="">${allLabel}</option>` +
      vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if ([...selEl.options].some((o) => o.value === cur)) selEl.value = cur;
  };
  fillSelect('#fi-staff', $('#f-staff'), d.staff, 'সব ষ্টাফ');
  fillSelect('#fi-center', $('#f-center'), d.centerCode, 'সব সেন্টার');
  $('#fi-member').classList.toggle('hidden', d.memberCode < 0 && d.memberName < 0);
  $('#fi-date').classList.toggle('hidden', d.date < 0);
}

/* ---------------- CSV আপলোড ফ্লো ---------------- */
function handleCSVFile(file) {
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
        .map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');

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
  const { headers, rows, detect } = state.csvData;
  const btn = $('#btn-apply-csv');
  btn.disabled = true;
  btn.textContent = '⏳ তৈরি হচ্ছে...';

  state.headers = headers;
  state.rows = rows;
  state.detect = detect;
  state.filters = { staff: '', center: '', member: '', date: '' };
  $('#f-staff').value = ''; $('#f-center').value = ''; $('#f-member').value = ''; $('#f-date').value = '';

  populateFilters();
  renderAll();
  $('#csv-modal').classList.add('hidden');

  const c = countByStatus(rows);
  toast(`✅ ${fmt(rows.length)} সারি — বাকী ${fmt(c.due)} · আদায় ${fmt(c.paid)} · আংশিক ${fmt(c.partial)}`);

  btn.textContent = '📊 টেবিল দেখুন';
  btn.disabled = false;
  try {
    await persistRows();
  } catch (e) {
    toast('সেভ সমস্যা: ' + e.message, true);
  }
}

/* ---------------- সেটআপ স্ক্রিন ---------------- */
function showSetup() {
  $('#setup-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#set-token').value = settings.token;
  $('#set-owner').value = settings.owner;
  $('#set-repo').value = settings.repo;
  $('#set-branch').value = settings.branch;
  $('#set-refresh').value = settings.refreshSec;
  $('#set-members-path').value = settings.membersPath;
  $('#set-autorefresh').checked = settings.autoRefresh;
}

function readSetupForm() {
  settings.mode = 'github';
  settings.token = $('#set-token').value.trim();
  settings.owner = $('#set-owner').value.trim();
  settings.repo = $('#set-repo').value.trim();
  settings.branch = $('#set-branch').value.trim() || 'main';
  settings.refreshSec = Math.max(10, num($('#set-refresh').value) || 60);
  settings.membersPath = $('#set-members-path').value.trim() || 'data/installments.json';
  settings.autoRefresh = $('#set-autorefresh').checked;
}

let syncTimer = null;
function restartSyncTimer() {
  clearInterval(syncTimer);
  if (settings.autoRefresh && !isLocal()) {
    syncTimer = setInterval(async () => {
      try { await loadDB(true); } catch { /* নেটওয়ার্ক সমস্যা — চুপচাপ */ }
    }, settings.refreshSec * 1000);
  }
}

async function startApp() {
  $('#setup-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#sync-dot').className = 'dot';
  try {
    await loadDB();
  } catch (e) {
    if (!isLocal() && AUTH_ERR.test(e.message)) {
      settings.mode = 'local';
      saveSettings();
      toast('⚠️ GitHub টোকেন কাজ করছে না — লোকাল মোডে চালানো হচ্ছে');
      try { await loadDB(); } catch { /* লোকালে সমস্যা হয় না */ }
    } else {
      $('#sync-status').textContent = 'সিঙ্ক এরর: ' + e.message;
      $('#sync-dot').classList.add('err');
      toast('ডাটা লোড করতে সমস্যা: ' + e.message, true);
      renderAll();
      return;
    }
  }
  $('#sync-dot').classList.add('ok');
  populateFilters();
  renderAll();
  restartSyncTimer();
}

/* ---------------- Events ---------------- */
function bindEvents() {
  // হেডার বাটন
  $('#btn-refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin');
    try { await loadDB(); $('#sync-dot').classList.add('ok'); populateFilters(); renderAll(); toast('🔄 রিফ্রেশ সম্পন্ন'); }
    catch (err) { toast('রিফ্রেশ ব্যর্থ: ' + err.message, true); }
    btn.classList.remove('spin');
  });
  const openUpload = () => {
    $('#csv-modal').classList.remove('hidden');
    $('#csv-preview-wrap').classList.add('hidden');
    $('#csv-error').classList.add('hidden');
    $('#btn-apply-csv').disabled = true;
    $('#csv-file').value = '';
  };
  $('#btn-upload').addEventListener('click', openUpload);
  $('#btn-upload-2').addEventListener('click', openUpload);
  $('#btn-settings').addEventListener('click', showSetup);

  // ফিল্টার
  $('#f-staff').addEventListener('change', (e) => { state.filters.staff = e.target.value; renderTables(); });
  $('#f-center').addEventListener('change', (e) => { state.filters.center = e.target.value; renderTables(); });
  $('#f-member').addEventListener('input', (e) => { state.filters.member = e.target.value.trim(); renderTables(); });
  $('#f-date').addEventListener('change', (e) => { state.filters.date = e.target.value; renderTables(); });
  $('#btn-clear-filters').addEventListener('click', () => {
    state.filters = { staff: '', center: '', member: '', date: '' };
    $('#f-staff').value = ''; $('#f-center').value = ''; $('#f-member').value = ''; $('#f-date').value = '';
    renderTables();
    toast('✖ ফিল্টার মুছে ফেলা হয়েছে');
  });

  // চিপস → সেকশনে স্ক্রল
  [['chip-due', 'sec-due'], ['chip-paid', 'sec-paid'], ['chip-partial', 'sec-partial']].forEach(([chip, sec]) => {
    $('#' + chip).addEventListener('click', () => {
      const el = $('#' + sec);
      el.classList.remove('collapsed');
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // কোল্যাপস
  $$('.table-head').forEach((h) => h.addEventListener('click', () => {
    $('#' + h.dataset.collapse).classList.toggle('collapsed');
  }));

  // মডাল বন্ধ
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => $('#' + b.dataset.close).classList.add('hidden')));
  $$('.modal-overlay').forEach((ov) => ov.addEventListener('click', (e) => {
    if (e.target === ov) ov.classList.add('hidden');
  }));

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

  // সেটআপ
  $('#btn-local-mode').addEventListener('click', () => {
    settings.mode = 'local';
    saveSettings();
    startApp();
    toast('📱 লোকাল মোড চালু — ডাটা এই ব্রাউজারে সেভ হবে');
  });
  $('#btn-test-conn').addEventListener('click', async () => {
    readSetupForm();
    const errEl = $('#setup-error');
    errEl.classList.add('hidden');
    if (!settings.token || !settings.owner || !settings.repo) {
      errEl.textContent = '⚠️ Token, Owner ও Repo Name লিখুন।';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      const res = await fetch(`${API}/repos/${settings.owner}/${settings.repo}`, { headers: ghHeaders() });
      if (!res.ok) throw new Error(`GitHub ${res.status}: রেপো বা টোকেন ভুল হতে পারে`);
      const r = await res.json();
      errEl.textContent = '';
      toast(`✅ সংযোগ সফল — ${r.full_name} (default branch: ${r.default_branch})`);
      settings.branch = r.default_branch;
      $('#set-branch').value = r.default_branch;
    } catch (e) {
      errEl.textContent = '⚠️ ' + e.message;
      errEl.classList.remove('hidden');
    }
  });
  $('#btn-save-settings').addEventListener('click', async () => {
    readSetupForm();
    const errEl = $('#setup-error');
    errEl.classList.add('hidden');
    if (!settings.token || !settings.owner || !settings.repo) {
      errEl.textContent = '⚠️ Token, Owner ও Repo Name লিখুন।';
      errEl.classList.remove('hidden');
      return;
    }
    saveSettings();
    try {
      await startApp();
      toast('💾 সেটিংস সেভ হয়েছে');
    } catch (e) {
      showSetup();
      errEl.textContent = '⚠️ ডাটা লোড করতে পারলাম না: ' + e.message;
      errEl.classList.remove('hidden');
    }
  });
}

/* ---------------- Init ---------------- */
bindEvents();
if (settings.mode === 'github' && settings.token && settings.owner && settings.repo) {
  startApp();
} else {
  // টোকেন/সেটআপ ছাড়াই সরাসরি লোকাল মোডে চালু (⚙️ সেটিংস থেকে পরে GitHub যোগ করা যায়)
  const firstTime = settings.mode !== 'local';
  settings.mode = 'local';
  saveSettings();
  startApp();
  if (firstTime) toast('📱 লোকাল মোডে চালু হয়েছে — এখনই CSV আপলোড করে শুরু করুন!');
}
