/* =========================================================
   কালেকশন ম্যানেজার
   - CSV → GitHub-ভিত্তিক ডাটাবেস (JSON ফাইল)
   - প্রতিনিয়ত GitHub থেকে সিঙ্ক
   - ২ পেজ: বাকী/আদায় তালিকা + আজকের আদায়
   ========================================================= */
'use strict';

/* ---------------- Utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
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
const todayISO = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric' });
};

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

/* ---------------- Settings (localStorage) ---------------- */
const SET_KEY = 'collectionManager.settings.v1';
const defaultSettings = () => ({
  token: '', owner: '', repo: '', branch: 'main',
  membersPath: 'data/members.json',
  collectionsPath: 'data/collections.json',
  autoRefresh: true, refreshSec: 60,
});
let settings = { ...defaultSettings(), ...(JSON.parse(localStorage.getItem(SET_KEY) || '{}')) };
const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));

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
  const url = `${API}/repos/${settings.owner}/${settings.repo}/contents/${ghPath(path)}?ref=${encodeURIComponent(settings.branch)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  if (data.type !== 'file') throw new Error(`পাথটি একটি ফাইল নয়: ${path}`);
  return { sha: data.sha, text: b64decode(data.content) };
}

async function ghWriteFile(path, text, message) {
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

/* ---------------- App state ---------------- */
const state = {
  members: [],          // [{id, code, name, center_code, center_name, kisti, savings, dps, phone}]
  collections: [],      // [{id, date, time, member_code, member_name, center_code, center_name, kisti, savings, dps, total, paid, next_date}]
  lastSync: null,
  expanded: new Set(),  // expanded member ids
  collapsed: new Set(), // collapsed table sections
  page: 'dues',
  csvData: null,        // uploaded CSV working copy
};

const loadDB = async (quiet = false) => {
  const [m, c] = await Promise.all([
    ghReadFile(settings.membersPath),
    ghReadFile(settings.collectionsPath),
  ]);
  const members = m ? JSON.parse(m.text).members : [];
  const collections = c ? JSON.parse(c.text).collections : [];
  const changed =
    JSON.stringify(state.members) !== JSON.stringify(members) ||
    JSON.stringify(state.collections) !== JSON.stringify(collections);
  state.members = members;
  state.collections = collections;
  state.lastSync = new Date();
  if (changed && quiet) { renderAll(); toast('🔄 GitHub থেকে ডাটা আপডেট হয়েছে'); }
};

const persistMembers = () =>
  ghWriteFile(settings.membersPath, JSON.stringify({ updated_at: new Date().toISOString(), members: state.members }, null, 2), 'members: CSV update');

const persistCollections = (msg) =>
  ghWriteFile(settings.collectionsPath, JSON.stringify({ updated_at: new Date().toISOString(), collections: state.collections }, null, 2), msg || 'collection update');

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
  text = text.replace(/^﻿/, '');
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

const FIELD_DEFS = [
  { key: 'code', label: 'মেম্বার কোড', required: true, aliases: ['member code', 'member_code', 'mem code', 'memcode', 'code', 'id', 'সদস্য কোড', 'কোড', 'মেম্বার কোড', 'member id'] },
  { key: 'name', label: 'মেম্বার নাম', required: true, aliases: ['member name', 'member_name', 'name', 'নাম', 'সদস্যের নাম', 'মেম্বার নাম'] },
  { key: 'center_code', label: 'সেন্টার কোড', required: true, aliases: ['center code', 'centre code', 'center_code', 'centre_code', 'কেন্দ্র কোড', 'সেন্টার কোড', 'center', 'কেন্দ্র'] },
  { key: 'center_name', label: 'সেন্টার নাম', required: false, aliases: ['center name', 'centre name', 'center_name', 'centre_name', 'কেন্দ্রের নাম', 'সেন্টারের নাম', 'কেন্দ্র নাম'] },
  { key: 'kisti', label: 'কিস্তি (৳)', required: true, aliases: ['kisti', 'kisti amount', 'installment', 'installment amount', 'কিস্তি', 'কিস্তি টাকা', 'কিস্তি পরিমাণ', 'amount', 'টাকা'] },
  { key: 'savings', label: 'সঞ্চয় (৳)', required: false, aliases: ['savings', 'সঞ্চয়', 'সঞ্চয় টাকা'] },
  { key: 'dps', label: 'DPS (৳)', required: false, aliases: ['dps', 'ডিপিএস'] },
  { key: 'phone', label: 'ফোন (ঐচ্ছিক)', required: false, aliases: ['phone', 'mobile', 'মোবাইল', 'মোবাইল নম্বর', 'ফোন', 'telephone'] },
  { key: 'next_due', label: 'পরবর্তী তারিখ (ঐচ্ছিক)', required: false, aliases: ['next due date', 'due date', 'next_due', 'next_due_date', 'পরবর্তী তারিখ', 'পরবর্তী টাকা দেওয়ার তারিখ', 'due', 'date'] },
];

function autoMapHeaders(headers) {
  const lower = headers.map((h) => norm(h.replace(/[_-]+/g, ' ')));
  const map = {};
  for (const def of FIELD_DEFS) {
    let idx = -1;
    for (let i = 0; i < lower.length; i++) {
      const h = lower[i];
      if (def.aliases.some((a) => h === a || (a.length > 3 && h.includes(a)))) { idx = i; break; }
    }
    map[def.key] = idx;
  }
  return map;
}

/* CSV → ডাটাবেজ মার্জ */
function applyCSVToDB(rows, headers, map, replaceAll) {
  if (replaceAll) state.members = [];
  const byCode = new Map(state.members.map((m) => [norm(m.code), m]));
  let added = 0, updated = 0;

  for (const r of rows) {
    const code = (r[map.code] ?? '').toString().trim();
    const name = (r[map.name] ?? '').toString().trim();
    const centerCode = (r[map.center_code] ?? '').toString().trim();
    if (!code || !name || !centerCode) continue;

    const data = {
      code,
      name,
      center_code: centerCode,
      center_name: (map.center_name >= 0 ? r[map.center_name] : '')?.toString().trim() || centerCode,
      kisti: num(r[map.kisti]),
      savings: map.savings >= 0 ? num(r[map.savings]) : 0,
      dps: map.dps >= 0 ? num(r[map.dps]) : 0,
      phone: map.phone >= 0 ? (r[map.phone] ?? '').toString().trim() : '',
      next_due: map.next_due >= 0 ? (r[map.next_due] ?? '').toString().trim() : '',
    };

    const existing = byCode.get(norm(code));
    if (existing) {
      Object.assign(existing, data);
      updated++;
    } else {
      state.members.push({ id: uid(), ...data });
      byCode.set(norm(code), state.members[state.members.length - 1]);
      added++;
    }
  }
  return { added, updated, total: state.members.length };
}

/* ---------------- Derived status ---------------- */
const recordsFor = (code) => state.collections.filter((c) => norm(c.member_code) === norm(code));

function latestRecord(m) {
  const rs = recordsFor(m.code);
  if (!rs.length) return null;
  return rs.slice().sort((a, b) => (b.date + b.time + b.id).localeCompare(a.date + a.time + a.id))[0];
}
function todayRecord(m) {
  const rs = recordsFor(m.code).filter((c) => c.date === todayISO());
  if (!rs.length) return null;
  return rs.slice().sort((a, b) => (b.time + b.id).localeCompare(a.time + a.id))[0];
}
const isPaidToday = (m) => {
  const r = todayRecord(m);
  return !!(r && r.paid);
};
const lastPaidDate = (m) => {
  const rs = recordsFor(m.code).filter((c) => c.paid).sort((a, b) => b.date.localeCompare(a.date));
  return rs.length ? rs[0].date : null;
};
const nextDueFor = (m) => {
  const rs = recordsFor(m.code).filter((c) => !c.paid && c.next_date).sort((a, b) => b.date.localeCompare(a.date));
  return rs.length ? rs[0].next_date : (m.next_due || '');
};

/* ---------------- Rendering ---------------- */
function renderAll() {
  renderHeader();
  renderPage();
}

function renderHeader() {
  $('#repo-badge').textContent = `${settings.owner}/${settings.repo} · ${settings.branch}`;
  $('#sync-status').textContent = state.lastSync
    ? `সিঙ্ক হয়েছে ${state.lastSync.toLocaleTimeString('bn-BD')}`
    : 'সিঙ্ক হয়নি';
}

function renderPage() {
  const isToday = state.page === 'today';
  $('#page-dues').classList.toggle('hidden', isToday);
  $('#page-today').classList.toggle('hidden', !isToday);
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === state.page));
  if (!isToday) renderDuesPage(); else renderTodayPage();
}

function memberRowHTML(m, paidToday) {
  const exp = state.expanded.has(m.id);
  const lastPaid = lastPaidDate(m);
  const nextDue = nextDueFor(m);
  const detail = `
    <div class="expand-cell">
      <div class="expand-item"><span>মেম্বার কোড</span><strong>${esc(m.code)}</strong></div>
      <div class="expand-item"><span>সেন্টার</span><strong>${esc(m.center_code)} — ${esc(m.center_name)}</strong></div>
      <div class="expand-item"><span>মাসিক কিস্তি</span><strong>৳ ${fmt(m.kisti)}</strong></div>
      <div class="expand-item"><span>সঞ্চয়</span><strong>৳ ${fmt(m.savings)}</strong></div>
      <div class="expand-item"><span>DPS</span><strong>৳ ${fmt(m.dps)}</strong></div>
      <div class="expand-item"><span>গত আদায়</span><strong>${lastPaid ? fmtDate(lastPaid) : '—'}</strong></div>
      <div class="expand-item"><span>পরবর্তী তারিখ</span><strong>${nextDue ? fmtDate(nextDue) : '—'}</strong></div>
      <div class="expand-item"><span>ফোন</span><strong>${esc(m.phone || '—')}</strong></div>
    </div>`;
  return `
    <tr class="member-row ${exp ? 'expanded' : ''}" data-id="${m.id}">
      <td class="col-exp"><button class="exp-btn" data-expand="${m.id}">▼</button></td>
      <td class="code-cell">${esc(m.code)}</td>
      <td class="name-cell">${esc(m.name)}${paidToday ? '<span class="paid-tag">আজ দিয়েছে</span>' : ''}${nextDue ? `<span class="due-tag">পরবর্তী: ${fmtDate(nextDue)}</span>` : ''}</td>
      <td>${esc(m.center_code)}</td>
      <td>${esc(m.center_name)}</td>
      <td class="amt">৳ ${fmt(m.kisti)}</td>
    </tr>
    <tr class="expand-row ${exp ? '' : 'hidden'}" data-expand-row="${m.id}">
      <td colspan="6">${exp ? detail : ''}</td>
    </tr>`;
}

function renderDuesPage() {
  const q = norm($('#search').value);
  const cf = norm($('#center-filter').value);
  const match = (m) =>
    (!q || norm(m.code).includes(q) || norm(m.name).includes(q) || norm(m.center_name).includes(q) || norm(m.center_code).includes(q)) &&
    (!cf || norm(m.center_code) === cf || norm(m.center_name) === cf);

  const remaining = state.members.filter((m) => !isPaidToday(m) && match(m))
    .sort((a, b) => a.center_code.localeCompare(b.center_code) || a.code.localeCompare(b.code));
  const paid = state.members.filter((m) => isPaidToday(m) && match(m))
    .sort((a, b) => a.center_code.localeCompare(b.center_code) || a.code.localeCompare(b.code));

  $('#count-remaining').textContent = fmt(remaining.length);
  $('#count-paid').textContent = fmt(paid.length);
  $('#tbl-remaining').innerHTML = remaining.map((m) => memberRowHTML(m, false)).join('');
  $('#tbl-paid').innerHTML = paid.map((m) => memberRowHTML(m, true)).join('');
  $('#empty-remaining').classList.toggle('hidden', remaining.length > 0);
  $('#empty-paid').classList.toggle('hidden', paid.length > 0);

  // center filter
  const centers = [...new Map(state.members.map((m) => [norm(m.center_code), m])).values()]
    .sort((a, b) => a.center_code.localeCompare(b.center_code));
  const sel = $('#center-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">সব কেন্দ্র</option>' +
    centers.map((m) => `<option value="${esc(m.center_code)}">${esc(m.center_code)} — ${esc(m.center_name)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';

  // collapsed sections
  $('#sec-remaining').classList.toggle('collapsed', state.collapsed.has('sec-remaining'));
  $('#sec-paid').classList.toggle('collapsed', state.collapsed.has('sec-paid'));
}

function renderTodayPage() {
  const mode = $('#today-filter').value;
  let recs = state.collections.filter((c) => c.paid);
  if (mode === 'today') recs = recs.filter((c) => c.date === todayISO());
  recs = recs.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  $('#today-title').textContent = mode === 'today'
    ? `আজকের আদায় — ${fmtDate(todayISO())}`
    : 'সব আদায়ের রেকর্ড';

  $('#tbl-today').innerHTML = recs.map((c) => `
    <tr>
      <td class="code-cell">${esc(c.member_code)}</td>
      <td class="name-cell">${esc(c.member_name)}${mode === 'all' ? `<span class="center-sub">${fmtDate(c.date)}</span>` : ''}</td>
      <td>${esc(c.center_code)}</td>
      <td class="amt">৳ ${fmt(c.kisti)}</td>
      <td class="amt">৳ ${fmt(c.savings)}</td>
      <td class="amt">৳ ${fmt(c.dps)}</td>
      <td class="amt"><strong>৳ ${fmt(c.total)}</strong></td>
      <td class="col-del"><button class="del-btn" data-del="${c.id}" title="মুছুন">🗑</button></td>
    </tr>`).join('');
  $('#empty-today').classList.toggle('hidden', recs.length > 0);

  const sum = (k) => recs.reduce((a, c) => a + num(c[k]), 0);
  $('#tot-kisti').textContent = '৳ ' + fmt(sum('kisti'));
  $('#tot-savings').textContent = '৳ ' + fmt(sum('savings'));
  $('#tot-dps').textContent = '৳ ' + fmt(sum('dps'));
  $('#tot-count').textContent = fmt(new Set(recs.map((c) => norm(c.member_code))).size);
}

/* ---------------- Member popup (আদায়) ---------------- */
let currentMember = null;
let payMode = true; // true = দেওয়া হয়েছে

function openMemberModal(m) {
  currentMember = m;
  payMode = true;
  $('#mm-name').textContent = `${m.name} (${m.code})`;
  const lastPaid = lastPaidDate(m);
  const nextDue = nextDueFor(m);
  $('#mm-details').innerHTML = `
    <div class="detail-item"><span>মেম্বার কোড</span><strong>${esc(m.code)}</strong></div>
    <div class="detail-item"><span>সেন্টার কোড</span><strong>${esc(m.center_code)}</strong></div>
    <div class="detail-item full"><span>সেন্টার নাম</span><strong>${esc(m.center_name)}</strong></div>
    <div class="detail-item"><span>কিস্তি (৳)</span><strong>${fmt(m.kisti)}</strong></div>
    <div class="detail-item"><span>সঞ্চয় (৳)</span><strong>${fmt(m.savings)}</strong></div>
    <div class="detail-item"><span>DPS (৳)</span><strong>${fmt(m.dps)}</strong></div>
    <div class="detail-item"><span>গত আদায়</span><strong>${lastPaid ? fmtDate(lastPaid) : '—'}</strong></div>
    <div class="detail-item"><span>পরবর্তী তারিখ</span><strong>${nextDue ? fmtDate(nextDue) : '—'}</strong></div>
    <div class="detail-item"><span>ফোন</span><strong>${esc(m.phone || '—')}</strong></div>`;

  // history
  const hist = recordsFor(m.code).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 5);
  $('#mm-history-box').classList.toggle('hidden', !hist.length);
  $('#mm-history').innerHTML = hist.map((c) => `
    <div class="history-item ${c.paid ? '' : 'unpaid'}">
      <span>${fmtDate(c.date)}</span>
      <span class="h-amt">${c.paid ? '৳ ' + fmt(c.total) : 'বাকি — পরবর্তী: ' + fmtDate(c.next_date)}</span>
    </div>`).join('');

  // defaults
  $('#in-kisti').value = m.kisti || 0;
  $('#in-savings').value = m.savings || 0;
  $('#in-dps').value = m.dps || 0;
  $('#in-next-date').value = m.next_due || '';
  $('#collect-error').classList.add('hidden');
  setPayMode(true);
  $('#member-modal').classList.remove('hidden');
}

function setPayMode(paid) {
  payMode = paid;
  $('#pay-yes').classList.toggle('active', paid);
  $('#pay-no').classList.toggle('active', !paid);
  $('#amount-fields').classList.toggle('hidden', !paid);
  $('#next-date-wrap').classList.toggle('hidden', paid);
  updateTotal();
}

function updateTotal() {
  const t = num($('#in-kisti').value) + num($('#in-savings').value) + num($('#in-dps').value);
  $('#in-total').textContent = '৳ ' + fmt(t);
}

async function saveCollection() {
  if (!currentMember) return;
  const m = currentMember;
  const errEl = $('#collect-error');
  errEl.classList.add('hidden');

  const now = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

  if (payMode) {
    const kisti = num($('#in-kisti').value), savings = num($('#in-savings').value), dps = num($('#in-dps').value);
    if (kisti + savings + dps <= 0) {
      errEl.textContent = 'কমপক্ষে একটি ফিল্ডে টাকা দিন।';
      errEl.classList.remove('hidden');
      return;
    }
    state.collections.push({
      id: uid(), date: todayISO(), time,
      member_code: m.code, member_name: m.name,
      center_code: m.center_code, center_name: m.center_name,
      kisti, savings, dps,
      total: kisti + savings + dps,
      paid: true, next_date: '',
    });
  } else {
    const nd = $('#in-next-date').value;
    if (!nd) {
      errEl.textContent = 'টাকা না দিলে "পরবর্তী টাকা দেওয়ার তারিখ" দিতে হবে।';
      errEl.classList.remove('hidden');
      return;
    }
    state.collections.push({
      id: uid(), date: todayISO(), time,
      member_code: m.code, member_name: m.name,
      center_code: m.center_code, center_name: m.center_name,
      kisti: 0, savings: 0, dps: 0, total: 0,
      paid: false, next_date: nd,
    });
  }

  try {
    await persistCollections(`collection: ${m.code} ${payMode ? 'paid' : 'deferred'}`);
    $('#member-modal').classList.add('hidden');
    renderAll();
    toast(payMode ? '✅ আদায় সেভ হয়েছে' : '🕒 পরবর্তী তারিখ সেভ হয়েছে');
  } catch (e) {
    state.collections.pop();
    errEl.textContent = 'সেভ করতে পারলাম না: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

/* ---------------- CSV upload flow ---------------- */
function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      const delim = detectDelimiter(text.split(/\r?\n/)[0] || '');
      const rows = parseCSV(text, delim);
      if (rows.length < 2) throw new Error('CSV-তে হেডার ও অন্তত ১ সারি দরকার।');
      const headers = rows[0].map((h) => h.trim());
      const data = rows.slice(1);
      state.csvData = { headers, data, map: autoMapHeaders(headers) };
      renderCSVMapping();
      $('#csv-preview-wrap').classList.remove('hidden');
      $('#btn-apply-csv').disabled = false;
      $('#csv-error').classList.add('hidden');
    } catch (e) {
      showCSVError(e.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function renderCSVMapping() {
  const { headers, data, map } = state.csvData;
  $('#mapping-grid').innerHTML = FIELD_DEFS.map((def) => `
    <div class="map-item">
      <label>${def.label}${def.required ? ' *' : ''}</label>
      <select data-mapfield="${def.key}">
        <option value="-1">— বাদ দিন —</option>
        ${headers.map((h, i) => `<option value="${i}" ${map[def.key] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}
      </select>
    </div>`).join('');

  // preview
  const preview = data.slice(0, 5);
  $('#csv-preview thead').innerHTML = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  $('#csv-preview tbody').innerHTML = preview.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('');
}

function showCSVError(msg) {
  const el = $('#csv-error');
  el.textContent = '⚠️ ' + msg;
  el.classList.remove('hidden');
}

async function applyCSV() {
  const { data, map } = state.csvData;
  const required = ['code', 'name', 'center_code', 'kisti'];
  for (const k of required) {
    if (map[k] < 0) { showCSVError('দয়া করে বাধ্যতামূলক ফিল্ড ম্যাপ করুন: ' + k); return; }
  }
  const replaceAll = $('#csv-replace').checked;
  const btn = $('#btn-apply-csv');
  btn.disabled = true;
  btn.textContent = '⏳ সেভ হচ্ছে…';
  try {
    const res = applyCSVToDB(data, null, map, replaceAll);
    await persistMembers();
    $('#csv-modal').classList.add('hidden');
    $('#csv-preview-wrap').classList.add('hidden');
    $('#btn-apply-csv').disabled = false;
    $('#btn-apply-csv').textContent = '💾 ডাটাবেজ আপডেট করুন';
    renderAll();
    toast(`✅ ডাটাবেজ আপডেট: ${fmt(res.added)} নতুন, ${fmt(res.updated)} আপডেট, মোট ${fmt(res.total)} সদস্য`);
  } catch (e) {
    showCSVError('সেভ করতে পারলাম না: ' + e.message);
    btn.disabled = false;
    btn.textContent = '💾 ডাটাবেজ আপডেট করুন';
  }
}

/* ---------------- Auto-sync ---------------- */
let syncTimer = null;
function restartSyncTimer() {
  clearInterval(syncTimer);
  if (settings.autoRefresh && settings.refreshSec >= 10) {
    syncTimer = setInterval(async () => {
      try { await loadDB(true); } catch { /* নেটওয়ার্ক সমস্যা — চুপচাপ */ }
    }, settings.refreshSec * 1000);
  }
}

/* ---------------- Setup screen ---------------- */
function showSetup() {
  $('#setup-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#set-token').value = settings.token;
  $('#set-owner').value = settings.owner;
  $('#set-repo').value = settings.repo;
  $('#set-branch').value = settings.branch;
  $('#set-refresh').value = settings.refreshSec;
  $('#set-members-path').value = settings.membersPath;
  $('#set-collections-path').value = settings.collectionsPath;
  $('#set-autorefresh').checked = settings.autoRefresh;
}

function readSetupForm() {
  settings.token = $('#set-token').value.trim();
  settings.owner = $('#set-owner').value.trim();
  settings.repo = $('#set-repo').value.trim();
  settings.branch = $('#set-branch').value.trim() || 'main';
  settings.refreshSec = Math.max(10, num($('#set-refresh').value) || 60);
  settings.membersPath = $('#set-members-path').value.trim() || 'data/members.json';
  settings.collectionsPath = $('#set-collections-path').value.trim() || 'data/collections.json';
  settings.autoRefresh = $('#set-autorefresh').checked;
}

async function startApp() {
  $('#setup-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#sync-dot').className = 'dot';
  try {
    await loadDB();
    $('#sync-dot').classList.add('ok');
    renderAll();
    restartSyncTimer();
  } catch (e) {
    $('#sync-status').textContent = 'সিঙ্ক এরর: ' + e.message;
    $('#sync-dot').classList.add('err');
    toast('ডাটা লোড করতে সমস্যা: ' + e.message, true);
    renderAll();
  }
}

/* ---------------- Events ---------------- */
function bindEvents() {
  // tabs
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    state.page = t.dataset.page;
    renderPage();
  }));

  // header buttons
  $('#btn-refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin');
    try { await loadDB(); $('#sync-dot').classList.add('ok'); renderAll(); toast('🔄 রিফ্রেশ সম্পন্ন'); }
    catch (err) { toast('রিফ্রেশ ব্যর্থ: ' + err.message, true); }
    btn.classList.remove('spin');
  });
  $('#btn-upload').addEventListener('click', () => $('#csv-modal').classList.remove('hidden'));
  $('#btn-settings').addEventListener('click', showSetup);

  // search & filters
  $('#search').addEventListener('input', renderDuesPage);
  $('#center-filter').addEventListener('change', renderDuesPage);
  $('#today-filter').addEventListener('change', renderTodayPage);

  // collapsible sections
  $$('.table-head').forEach((h) => h.addEventListener('click', () => {
    const id = h.dataset.collapse;
    state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id);
    $('#' + id).classList.toggle('collapsed');
  }));

  // table row interactions (event delegation)
  document.addEventListener('click', (e) => {
    const expBtn = e.target.closest('[data-expand]');
    if (expBtn) {
      e.stopPropagation();
      const id = expBtn.dataset.expand;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      const row = expBtn.closest('tr');
      row.classList.toggle('expanded');
      const next = row.nextElementSibling;
      if (next && next.dataset.expandRow === id) next.classList.toggle('hidden');
      return;
    }
    const mRow = e.target.closest('tr.member-row');
    if (mRow) {
      const m = state.members.find((x) => x.id === mRow.dataset.id);
      if (m) openMemberModal(m);
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      const id = delBtn.dataset.del;
      if (confirm('এই আদায়ের রেকর্ড মুছবেন?')) {
        state.collections = state.collections.filter((c) => c.id !== id);
        persistCollections('collection: delete').then(() => { renderAll(); toast('🗑 রেকর্ড মুছে ফেলা হয়েছে'); })
          .catch((err) => toast('মুছতে সমস্যা: ' + err.message, true));
      }
    }
  });

  // modals close
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => $('#' + b.dataset.close).classList.add('hidden')));
  $$('.modal-overlay').forEach((ov) => ov.addEventListener('click', (e) => {
    if (e.target === ov) ov.classList.add('hidden');
  }));

  // payment modal
  $('#pay-yes').addEventListener('click', () => setPayMode(true));
  $('#pay-no').addEventListener('click', () => setPayMode(false));
  ['#in-kisti', '#in-savings', '#in-dps'].forEach((id) => $(id).addEventListener('input', updateTotal));
  $('#btn-save-collection').addEventListener('click', saveCollection);

  // CSV modal
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
  $('#mapping-grid').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-mapfield]');
    if (sel) state.csvData.map[sel.dataset.mapfield] = parseInt(sel.value, 10);
  });
  $('#btn-apply-csv').addEventListener('click', applyCSV);

  // setup
  $('#btn-test-conn').addEventListener('click', async () => {
    readSetupForm();
    const errEl = $('#setup-error');
    errEl.classList.add('hidden');
    if (!settings.token || !settings.owner || !settings.repo) {
      errEl.textContent = '⚠️ Token, Owner ও RepName লিখুন।';
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
      errEl.textContent = '⚠️ Token, Owner ও RepName লিখুন।';
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
if (settings.token && settings.owner && settings.repo) {
  startApp();
} else {
  showSetup();
}
