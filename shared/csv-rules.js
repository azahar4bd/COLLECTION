/* ============================================================
   MIS রিপোর্ট ফাইল পার্সিং-র নিয়ম (CSV · লেগ্য .xls · HTML)
   — gBanker থেকে ডাউনলোড করা তিনটি ফাইল (কিস্তির তালিকা · সদস্য তালিকা ·
     পূর্বের স্থিতি) যে ফরম্যাটেই আসুক (CSV / .xls / HTML) — একই নিয়মে পড়া হয়,
     আর কোন ফাইলটি কী রিপোর্ট সেটা নিজে থেকেই চেনা হয়।
   ব্রাউজারে: window.COLLECTION_CSV · Node-এ: globalThis.COLLECTION_CSV
   ============================================================ */
(function (root) {
  const BN_DIGIT = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
  const toEn = (s) => String(s ?? '').replace(/[০-৯]/g, (d) => BN_DIGIT[d]);
  const num = (v) => {
    const n = parseFloat(toEn(String(v ?? '')).replace(/[৳,\sTk]/gi, ''));
    if (!Number.isFinite(n)) return 0;
    const rounded = Math.round(n * 100) / 100;
    return Number.isFinite(rounded) ? rounded : 0;
  };
  const normHeader = (h) => toEn(String(h ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '');

  function detectDelimiter(line) {
    const candidates = [',', ';', '\t', '|'];
    let best = ',', bestCount = 0;
    for (const d of candidates) {
      const count = line.split(d).length - 1;
      if (count > bestCount) { bestCount = count; best = d; }
    }
    return best;
  }

  /* quoted CSV পার্সার — কোটির মধ্যে নতুন লাইন থাকলেও ঠিক থাকে */
  /* ---------- HTML টেবিল → সারি (gBanker এক্সপোর্ট HTML হিসেবে দেয়) ---------- */
  function htmlTableToRows(html) {
    const source = String(html ?? '');
    const table = source.match(/<table[\s\S]*?<\/table>/i);
    if (!table) return null;
    const strip = (s) => String(s ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ').trim();
    const rows = [];
    const trs = table[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
    trs.forEach((tr) => {
      const cells = (tr.match(/<(td|th)[\s\S]*?<\/\1>/gi) || []).map(strip);
      if (cells.some((c) => c !== '')) rows.push(cells);
    });
    return rows.length ? rows : null;
  }

  /* ---------- UTF-8 ডিকোড (TextDecoder না থাকলেও চলে) ---------- */
  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8').decode(bytes); } catch { /* নিচে নিজস্ব পথ */ }
    }
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i++];
      if (b0 < 0x80) { out += String.fromCharCode(b0); continue; }
      let code = 0; let extra = 0;
      if ((b0 & 0xE0) === 0xC0) { code = b0 & 0x1F; extra = 1; }
      else if ((b0 & 0xF0) === 0xE0) { code = b0 & 0x0F; extra = 2; }
      else if ((b0 & 0xF8) === 0xF0) { code = b0 & 0x07; extra = 3; }
      else { out += '\uFFFD'; continue; }
      for (let k = 0; k < extra; k++) {
        const b = bytes[i++];
        if (b === undefined || (b & 0xC0) !== 0x80) { out += '\uFFFD'; break; }
        code = (code << 6) | (b & 0x3F);
      }
      out += String.fromCharCode(code);
    }
    return out;
  }

  /* ---------- ফাইলের ফরম্যাট শনাক্ত (লেগ্য .xls · HTML · CSV) ---------- */
  function detectFileFormat(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(0);
    if (bytes.length > 4 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return 'xls';
    let head = '';
    try { head = decodeUtf8(bytes.subarray(0, 2000)); } catch { head = ''; }
    head = head.replace(/^\uFEFF/, '').trimStart();
    if (/^<!doctype html/i.test(head) || /^<html/i.test(head) || /<table[\s>]/i.test(head)) return 'html';
    return 'csv';
  }

  /* ---------- যেকোনো ফরম্যাটের ফাইল → সারি (rows) ---------- */
  function readReportRows(buffer) {
    const format = detectFileFormat(buffer);
    if (format === 'xls') {
      const reader = root.COLLECTION_XLS;
      if (!reader) throw new Error('xls পাঠক (shared/xls-reader.js) লোড হয়নি — পেজটি রিফ্রেশ করুন।');
      const wb = reader.readWorkbook(buffer);
      const sheet = wb.sheets[0];
      if (!sheet || !sheet.rows.length) throw new Error('ফাইলে কোনো ডেটা পাওয়া যায়নি।');
      return { rows: sheet.rows, format: 'xls' };
    }
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(0);
    const text = decodeUtf8(bytes);
    if (format === 'html') {
      const rows = htmlTableToRows(text);
      if (!rows) throw new Error('HTML ফাইলে কোনো টেবিল পাওয়া যায়নি।');
      return { rows, format: 'html' };
    }
    const rows = parseCSV(text, detectDelimiter(String(text).split(/\r?\n/).find((line) => line.trim()) || ','));
    if (!rows.length) throw new Error('CSV ফাইলে কোনো সারি পাওয়া যায়নি।');
    return { rows, format: 'csv' };
  }

  /* ---------- ফাইলটি কোন রিপোর্ট? (হেডার দেখে নিজে থেকেই চেনা) ---------- */
  function detectReportType(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let best = null; let bestScore = 0; let bestIndex = -1;
    list.slice(0, 40).forEach((row, index) => {
      const h = (row || []).map(normHeader);
      const has = (...needles) => needles.some((n) => h.some((x) => x.includes(n)));
      let score = 0; let type = null;
      if (has('membercode', 'memberno') && has('installmentamount', 'installmentstartdate', 'installmentactual')) { score = 6; type = 'installment'; }
      else if (has('memberno', 'membercode') && has('contactnumber', 'mobile', 'phone')) { score = 6; type = 'member'; }
      else if (has('nameofmember') && has('memberid')) { score = 6; type = 'member'; }  // Monthly Savings & Loan Collection Report
      else if (has('generalsavingsbalance', 'vsosbalance', 'monthlyltssavings')) { score = 6; type = 'balance'; }
      else if (has('memberid', 'memberno') && has('loanbalance', 'loanoutstanding', 'passbookbalance', 'savingsbalance')) { score = 6; type = 'balance'; }
      if (score > bestScore) { bestScore = score; best = type; bestIndex = index; }
    });
    return { type: best, headerIndex: bestIndex, score: bestScore };
  }

  function parseCSV(text, delimiter) {
    text = String(text ?? '').replace(/^\uFEFF/, '');
    const delim = delimiter || ',';
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
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); if (row.some((v) => v.trim() !== '')) rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur.length || row.length) { row.push(cur); if (row.some((v) => v.trim() !== '')) rows.push(row); }
    return rows;
  }

  /* ---------- সদস্য তালিকা (MemberlistReport) ---------- */
  const MEMBER_COL_TESTS = {
    code: (h) => (h.includes('member') && (h.includes('no') || h.includes('code') || h.includes('number'))) || h === 'memno',
    center: (h) => h.includes('center') && (h.includes('code') || h.includes('name')),
    name: (h) => h.includes('membername') || h === 'name',
    mobile: (h) => h.includes('contactnumber') || h.includes('mobile') || h.includes('phone'),
    guardian: (h) => h.includes('father') || h.includes('husband') || h.includes('careof') || h.includes('guardian'),
    status: (h) => h.includes('status'),
  };
  function memberCol(headers, kind) {
    const hs = (headers || []).map((h) => normHeader(h));
    return hs.findIndex(MEMBER_COL_TESTS[kind] || (() => false));
  }
  function memberHeadersRow(rows) {
    return rows.findIndex((r) => {
      const n = r.map(normHeader);
      return n.some((x) => x.includes('member') && (x.includes('no') || x.includes('code')))
        && n.some((x) => x.includes('contact') || x.includes('mobile'));
    });
  }
  /* { headers, rows, stats } — stats: statusCounts, centers, withGuardian */
  function parseMemberReport(text) {
    const raw = parseCSV(text, detectDelimiter(String(text ?? '').split(/\r?\n/).find((line) => line.trim()) || ','));
    return parseMemberRows(raw);
  }
  /* সারি (rows) থেকে সদস্য তালিকা — CSV/.xls/HTML সব ফরম্যাটে কাজ করে */
  /* ---------- Monthly Savings & Loan Collection Report → সদস্য তালিকা ----------
     কলাম: S.L. No | Name of Member | Member ID | … বাকি সব অঙ্ক।
     সেন্টার (Samity) আসে সারির ভেতরের "Samity: 0001, GOBRA BAZAR" থেকে। */
  function isCollectionReport(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list.slice(0, 60).some((row) => {
      const h = (row || []).map(normHeader);
      return h.some((x) => x.includes('nameofmember')) && h.some((x) => x.includes('memberid'));
    });
  }
  function parseCollectionReportMembers(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const hi = list.findIndex((row) => {
      const h = (row || []).map(normHeader);
      return h.some((x) => x.includes('nameofmember')) && h.some((x) => x.includes('memberid'));
    });
    if (hi < 0) return null;
    const nh = list[hi].map((x) => normHeader(x));
    const idIndex = nh.findIndex((h) => h.includes('memberid'));
    const nameIndex = nh.findIndex((h) => h.includes('nameofmember') || h === 'name');
    const headers = ['Center Code & Name', 'Member No', 'Member Name', 'Contact Number', 'Father / Husband / Care Of'];
    const rows = [];
    let center = '';
    for (let i = hi + 1; i < list.length; i++) {
      const row = list[i] || [];
      const line = row.map((c) => String(c ?? '')).join(' ');
      const m = line.match(/Samity\s*:\s*([0-9]{1,6})\s*,?\s*([A-Za-z][A-Za-z ./&()-]*)/i);
      if (m) center = `${m[1].trim()}, ${m[2].trim()}`;
      const code = String(row[idIndex] ?? '').trim();
      const name = String(row[nameIndex] ?? '').replace(/\s+/g, ' ').trim();
      if (!code || !name || !/\d/.test(code)) continue;
      if (/total/i.test(name)) continue;
      rows.push([center, code, name, '', '']);
    }
    if (!rows.length) return null;
    const centers = new Set(rows.map((r) => String(r[0]).split(',')[0].trim()).filter(Boolean)).size;
    return { headers, rows, stats: { statusCounts: {}, centers, withGuardian: 0 } };
  }

  function parseMemberRows(raw) {
    const collection = parseCollectionReportMembers(raw);
    if (collection) return collection;
    const hi = memberHeadersRow(raw);
    if (hi < 0) throw new Error('হেডারে Member No এবং Contact Number থাকা CSV দিন।');
    const headers = raw[hi].map((x) => String(x).replace(/\s+/g, ' ').trim());
    const ci = memberCol(headers, 'code');
    const rows = raw.slice(hi + 1)
      .filter((r) => ci >= 0 && String(r[ci] || '').trim())
      .map((r) => headers.map((_, i) => String(r[i] || '').trim()));
    if (!rows.length) throw new Error('CSV-তে সদস্যের সারি পাওয়া যায়নি।');
    const statusIndex = memberCol(headers, 'status');
    const statusCounts = {};
    if (statusIndex >= 0) rows.forEach((r) => {
      const s = String(r[statusIndex] || '').trim() || 'অজানা';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    const centerIndex = memberCol(headers, 'center');
    const centers = centerIndex >= 0
      ? new Set(rows.map((r) => String(r[centerIndex] || '').split(',')[0].trim()).filter(Boolean)).size : 0;
    const guardianIndex = memberCol(headers, 'guardian');
    const withGuardian = guardianIndex >= 0 ? rows.filter((r) => String(r[guardianIndex] || '').trim()).length : 0;
    return { headers, rows, stats: { statusCounts, centers, withGuardian } };
  }


  /* ---------- পূর্বের স্থিতি: "Balance Compare with Passbook (POMIS)" ----------
     কলাম:  Member ID | Member Name | General Savings | VS/OS | Monthly/LTS | Loan Balance
     সারির শুরুতে "Item Code: XX.XX Item Name: …" (লোন প্রোডাক্ট গ্রুপ),
     শেষে "Item Total / Samity Total / Staff Total / Grand Total" — এগুলো বাদ দেওয়া হয়।
     একই সদস্যের একাধিক প্রোডাক্টের সারি থাকলে সঞ্চয়/লোন যোগ করে এক সারি হয়।
     আউটপুট আকার পুরোনো "Member ID | Member Name | Savings | DPS | Loan"-এর সাথে এক,
     যাতে অ্যাপের স্থিতি-কার্ড নতুন কোড ছাড়াই কাজ করে। */
  const PASSBOOK_HEADERS = ['Member ID', '', 'Member Name', 'Savings Balance', 'DPS Balance', 'Loan Balance'];
  function parsePassbookBalanceRows(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const hi = list.findIndex((row) => {
      const h = (row || []).map(normHeader);
      return h.some((x) => x.includes('generalsavingsbalance') || x.includes('vsosbalance') || x.includes('monthlyltssavings'));
    });
    if (hi < 0) return null;
    const nh = list[hi].map((x) => normHeader(x));
    const idx = (test) => nh.findIndex(test);
    const idIndex = idx((h) => h.includes('memberid') || h === 'memid' || h.includes('memberno'));
    const nameIndex = idx((h) => h.includes('membername') || h.includes('nameofmember'));
    const genIndex = idx((h) => h.includes('generalsavingsbalance'));
    const vsIndex = idx((h) => h.includes('vsosbalance'));
    const mltsIndex = idx((h) => h.includes('monthlyltssavings') || (h.includes('monthly') && h.includes('savings')));
    const loanIndex = idx((h) => h.includes('loanbalance') && !h.includes('passbook') && !h.includes('scpaid'));
    const principalIndex = idx((h) => h.includes('principalloan'));
    const disburseIndex = idx((h) => h.includes('disbursedate'));
    const overdueIndex = idx((h) => h.includes('overdue'));
    if (idIndex < 0 || nameIndex < 0) throw new Error('পাসবুক রিপোর্টে Member ID বা Member Name পাওয়া যায়নি।');

    let center = ''; let staff = ''; let item = '';
    const byMember = new Map();
    let records = 0;
    for (let rowIndex = 0; rowIndex < list.length; rowIndex++) {
      const cells = list[rowIndex] || [];
      const all = cells.map((c) => String(c ?? '').trim());
      const joined = all.join(' | ');
      // সেন্টার (সামিতি) ও ষ্টাফ হেডার — হেডার সারির উপরে-নিচে দুই জায়গাতেই থাকতে পারে
      const samityMatch = joined.match(/samity\s*code\s*:\s*(\d+)/i);
      if (samityMatch) {
        center = samityMatch[1];
        const staffMatch = joined.match(/staff\s*id\s*:\s*\d+\s*,\s*name\s*:\s*([^,|]+)/i);
        if (staffMatch) staff = staffMatch[1].trim();
        continue;
      }
      if (rowIndex <= hi) continue;   // হেডারের উপরের লাইনে সদস্যের সারি নেই
      if (/^(staff\s*id|branch\s*code|bandhu|balance compare)/i.test(all[0] || '')) continue;
      if (/^item\s*code/i.test(all[idIndex] || '')) { item = all[idIndex]; continue; }
      if (/item\s*total|samity\s*total|staff\s*total|grand\s*total/i.test(all[0] + ' ' + all[1] + ' ' + all[3])) continue;
      const id = String(cells[idIndex] ?? '').trim();
      if (!/^\d+$/.test(id)) continue;
      records++;
      const savings = num(cells[genIndex]) + num(cells[vsIndex]);
      const dps = num(cells[mltsIndex]);
      const loan = num(cells[loanIndex]);
      const key = id.replace(/^0+/, '') || id;
      if (!byMember.has(key)) byMember.set(key, { id: key, name: String(cells[nameIndex] ?? '').trim(), savings: 0, dps: 0, loan: 0, center, staff, item, principal: 0, disburse: '', overdue: 0, products: 0 });
      const rec = byMember.get(key);
      rec.savings += savings;
      rec.dps += dps;
      rec.loan += loan;
      rec.principal += num(cells[principalIndex]);
      rec.overdue += num(cells[overdueIndex]);
      if (!rec.disburse) rec.disburse = String(cells[disburseIndex] ?? '').trim();
      rec.products++;
    }
    if (!byMember.size) throw new Error('পাসবুক রিপোর্টে সদস্যের সারি পাওয়া যায়নি।');
    const rows = [];
    const totals = { loan: 0, savings: 0, dps: 0 };
    byMember.forEach((rec) => {
      rows.push([rec.id, '', rec.name, String(rec.savings), String(rec.dps), String(rec.loan), rec.center]);
      totals.loan += rec.loan; totals.savings += rec.savings; totals.dps += rec.dps;
    });
    const products = new Set([...byMember.values()].map((r) => r.item).filter(Boolean));
    return {
      headers: PASSBOOK_HEADERS.slice(),
      rows,
      stats: {
        members: byMember.size,
        records,
        totals,
        hasDps: true,
        format: 'passbook',
        center: byMember.values().next().value.center || '',
        staff: byMember.values().next().value.staff || '',
        products: products.size,
        multiProduct: [...byMember.values()].filter((r) => r.products > 1).length,
      },
    };
  }

  /* ---------- পূর্বের স্থিতি (Balance / Monthly Savings) ---------- */
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
  /* { headers, rows, stats:{members, records, totals:{loan,savings,dps}, hasDps} } */
  function parseBalanceReport(text) {
    const raw = parseCSV(text, detectDelimiter(String(text ?? '').split(/\r?\n/).find((line) => line.trim()) || ','));
    return parseBalanceRows(raw);
  }
  /* সারি (rows) থেকে পূর্বের স্থিতি — দুই ধরনের ফরম্যাটই ধরে:
     ১) "Balance Compare with Passbook (POMIS)" — General/VS-OS/Monthly-LTS + Loan Balance
     ২) সাধারণ CSV — Member ID | Member Name | Savings/DPS/Loan Balance */
  function parseBalanceRows(raw) {
    const passbook = parsePassbookBalanceRows(raw);
    if (passbook) return passbook;
    const hi = findBalanceHeaderRow(raw);
    if (hi < 0) throw new Error('Member ID, Member Name ও Loan/Savings Balance কলামসহ CSV দিন।');
    const headers = raw[hi].map((x) => String(x).replace(/\s+/g, ' ').trim());
    const pick = (re) => headers.findIndex((h) => re.test(normHeader(h)));
    const idIndex = pick(/memberid|membercode|memberno/);
    const nameIndex = pick(/nameofmember|membername/);
    const loanIndex = pick(/loan(outstanding|balance)|balance.*loan/);
    const savingsIndex = pick(/savings(outstanding|balance)|balance.*savings/);
    const dpsIndex = pick(/dps(outstanding|balance)|deposit(outstanding|balance)/);
    if (idIndex < 0 || loanIndex < 0) throw new Error('Member ID ও Loan Balance কলাম পাওয়া যায়নি।');
    let center = ''; let hasCenter = false; const records = [];
    for (const r of raw.slice(hi + 1)) {
      const first = String(r[0] || '').trim();
      const samity = first.match(/samity\s*:\s*(\d+)/i);
      if (samity) { center = samity[1]; hasCenter = true; continue; }
      if (/^(item\s*code|office\s*code|product\s*code)/i.test(first)) continue;   // লোন প্রোডাক্ট শিরোনাম — সদস্য নয়
      const id = String(r[idIndex] || '').trim();
      if (!/^\d+$/.test(id)) continue;
      records.push({
        id: id.replace(/^0+/, ''),
        name: nameIndex >= 0 ? String(r[nameIndex] || '').trim() : '',
        savings: savingsIndex >= 0 ? num(r[savingsIndex]) : 0,
        dps: dpsIndex >= 0 ? num(r[dpsIndex]) : 0,
        loan: loanIndex >= 0 ? num(r[loanIndex]) : 0,
        center,
      });
    }
    if (!records.length) throw new Error('CSV-তে সদস্যের স্থিতির সারি পাওয়া যায়নি।');
    const rows = [];
    let members = records.length;
    if (hasCenter) {
      // পুরোনো ফরম্যাট: একই ID ভিন্ন সেন্টারে ভিন্ন সদস্য হতে পারে — প্রতিটি সারি আলাদা।
      records.forEach((rec) => {
        const copy = headers.map((_, i) => (i === idIndex ? rec.id : i === nameIndex ? rec.name
          : i === savingsIndex ? String(rec.savings) : i === dpsIndex ? String(rec.dps)
          : i === loanIndex ? String(rec.loan) : ''));
        copy.push(rec.center);
        rows.push(copy);
      });
    } else {
      // নতুন ফরম্যাট: একই সদস্যের একাধিক লোন প্রোডাক্টের সারি এক করে যোগ হয়।
      const byMember = new Map();
      records.forEach((rec) => {
        const k = rec.id;
        if (!byMember.has(k)) byMember.set(k, []);
        byMember.get(k).push(rec);
      });
      members = byMember.size;
      byMember.forEach((list) => {
        const total = (pickValue) => {
          const values = list.map(pickValue);
          return values.every((v) => v === values[0]) ? values[0] : values.reduce((a, b) => a + b, 0);
        };
        const copy = headers.map((_, i) => (i === idIndex ? list[0].id : i === nameIndex ? list[0].name
          : i === savingsIndex ? String(total((r) => r.savings)) : i === dpsIndex ? String(total((r) => r.dps))
          : i === loanIndex ? String(total((r) => r.loan)) : ''));
        copy.push('');
        rows.push(copy);
      });
    }
    const totals = records.reduce((a, r) => ({ loan: a.loan + r.loan, savings: a.savings + r.savings, dps: a.dps + r.dps }),
      { loan: 0, savings: 0, dps: 0 });
    return { headers, rows, stats: { members, records: records.length, totals, hasDps: dpsIndex >= 0 } };
  }

  /* ---------- কিস্তির রিপোর্ট (MIS installment list) ---------- */
  function parseInstallmentReport(text) {
    const raw = parseCSV(text, detectDelimiter(String(text ?? '').split(/\r?\n/).find((line) => line.trim()) || ','));
    return parseInstallmentRows(raw);
  }
  /* সারি (rows) থেকে কিস্তির তালিকা */
  function parseInstallmentRows(raw) {
    if (!raw.length) throw new Error('CSV খালি।');
    let hi = 0, best = -1;
    raw.slice(0, 30).forEach((row, index) => {
      const n = row.map(normHeader);
      const score = (n.some((x) => x.includes('membercode') || x.includes('memberno')) ? 2 : 0)
        + (n.some((x) => x.includes('installmentamount')) ? 2 : 0)
        + (n.some((x) => x.includes('installmentactual')) ? 1 : 0)
        + (n.some((x) => x.includes('centercode')) ? 1 : 0);
      if (score > best) { best = score; hi = index; }
    });
    if (best < 3) hi = 0;   // হেডার চেনা না গেলে প্রথম সারিই হেডার ধরে
    const headers = raw[hi].map((x) => String(x).replace(/\s+/g, ' ').trim());
    const rows = raw.slice(hi + 1)
      .filter((r) => r.some((v) => String(v).trim() !== ''))
      .map((r) => headers.map((_, i) => String(r[i] ?? '').trim()));
    if (!rows.length) throw new Error('CSV-তে কিস্তির সারি পাওয়া যায়নি।');
    return { headers, rows };
  }

  root.COLLECTION_CSV = {
    toEn, num, normHeader, detectDelimiter, parseCSV, memberCol, memberHeadersRow,
    findBalanceHeaderRow, parseMemberReport, parseBalanceReport, parseInstallmentReport,
    htmlTableToRows, decodeUtf8, detectFileFormat, readReportRows, detectReportType,
    isCollectionReport, parseCollectionReportMembers,
    parseMemberRows, parseBalanceRows, parseInstallmentRows, parsePassbookBalanceRows,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
