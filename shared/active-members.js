/* ============================================================
   Active-only member directory
   Balance-এ nonzero স্থিতি অথবা current installment list-এ থাকা সদস্যদের
   পুরোনো directory থেকে compact contact রাখে। বাকি সদস্যের bulk directory
   row মুছে যায়; installment, balance, Today, collection বা history এখানে বদলায় না।
   Browser: window.COLLECTION_ACTIVE_MEMBERS · Node: require(...)
   ============================================================ */
(function (root) {
  const BN = { '০':'0', '১':'1', '২':'2', '৩':'3', '৪':'4', '৫':'5', '৬':'6', '৭':'7', '৮':'8', '৯':'9' };
  const text = (value) => String(value ?? '').replace(/[০-৯]/g, (d) => BN[d]);
  const digits = (value) => text(value).replace(/\D/g, '');
  const codeKey = (value) => digits(value).replace(/^0+/, '');
  const header = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const nameKey = (value) => text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const number = (value) => {
    const n = Number(text(value).replace(/[৳,\sTk]/gi, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const COMPACT_HEADERS = [
    'Center Code & Name', 'Member No', 'Member Name',
    'Contact Number', 'Father / Husband / Care Of',
  ];

  function memberColumn(headers, kind) {
    const hs = (headers || []).map(header);
    const tests = {
      code: (h) => (h.includes('member') && (h.includes('no') || h.includes('code') || h.includes('number'))) || h === 'memno',
      center: (h) => h.includes('center') && (h.includes('code') || h.includes('name')),
      name: (h) => h.includes('membername') || h === 'name',
      mobile: (h) => h.includes('contactnumber') || h.includes('mobile') || h.includes('phone'),
      guardian: (h) => h.includes('father') || h.includes('husband') || h.includes('careof') || h.includes('guardian'),
    };
    return hs.findIndex(tests[kind] || (() => false));
  }
  function findHeader(headers, tests) {
    return (headers || []).map(header).findIndex((h) => tests.some((test) => test(h)));
  }
  function add(map, key, index) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  }
  function unique(list) { return [...new Set(list || [])]; }

  function compactActiveMembers(input) {
    const oldHeaders = Array.isArray(input?.memberDBHeaders) ? input.memberDBHeaders : [];
    const oldRows = Array.isArray(input?.memberDB) ? input.memberDB : [];
    const balanceHeaders = Array.isArray(input?.balanceHeaders) ? input.balanceHeaders : [];
    const balanceRows = Array.isArray(input?.balanceRows) ? input.balanceRows : [];
    const installmentHeaders = Array.isArray(input?.installmentHeaders) ? input.installmentHeaders : [];
    const installmentRows = Array.isArray(input?.installmentRows) ? input.installmentRows : [];
    const unchanged = (reason) => ({
      headers: oldHeaders, rows: oldRows, skipped: true, reason,
      stats: { before: oldRows.length, after: oldRows.length, removed: 0, activeSources: 0, activeBalanceRows: 0, installmentSources: 0, matchedSources: 0 },
    });
    /* Data set এখনো load হয়নি—এ অবস্থায় directory খালি করা নিরাপদ নয়। */
    if (!balanceRows.length && !installmentRows.length) return unchanged('active-source-unavailable');
    if (!oldRows.length) return unchanged('member-directory-empty');

    const codeIndex = memberColumn(oldHeaders, 'code');
    if (codeIndex < 0) return unchanged('member-code-column-unavailable');
    const centerIndex = memberColumn(oldHeaders, 'center');
    const nameIndex = memberColumn(oldHeaders, 'name');
    const mobileIndex = memberColumn(oldHeaders, 'mobile');
    const guardianIndex = memberColumn(oldHeaders, 'guardian');

    const sources = [];
    let activeBalanceRows = 0;
    const bId = findHeader(balanceHeaders, [(h) => h.includes('memberid') || h.includes('membercode') || h.includes('memberno')]);
    const bName = findHeader(balanceHeaders, [(h) => h.includes('nameofmember') || h.includes('membername') || h === 'name']);
    const bCenter = findHeader(balanceHeaders, [(h) => h.includes('centercode') || h.includes('centername') || h.includes('samity')]);
    const bValues = (balanceHeaders || []).map((h, index) => {
      const n = header(h);
      return ((n.includes('loan') && (n.includes('balance') || n.includes('outstanding')))
        || (n.includes('savings') && (n.includes('balance') || n.includes('outstanding')))
        || n.includes('dpsbalance') || n.includes('vsosbalance')) ? index : -1;
    }).filter((index) => index >= 0);
    if (bId >= 0 && bValues.length) {
      balanceRows.forEach((row) => {
        if (!Array.isArray(row) || !bValues.some((index) => number(row[index]) !== 0)) return;
        activeBalanceRows += 1;
        sources.push({
          code: row[bId], name: bName >= 0 ? row[bName] : '',
          /* parseBalanceRows appended center আসে header count-এর পরের column-এ। */
          center: row[balanceHeaders.length] || (bCenter >= 0 ? row[bCenter] : ''), kind: 'balance',
        });
      });
    }

    const iCode = findHeader(installmentHeaders, [(h) => h.includes('membercode') || h.includes('memberno') || h.includes('memberid')]);
    const iName = findHeader(installmentHeaders, [(h) => h.includes('membername') || h.includes('nameofmember')]);
    const iCenter = findHeader(installmentHeaders, [(h) => h === 'centercode' || h.includes('centercode') || h.includes('centername')]);
    let installmentSources = 0;
    if (iCode >= 0) {
      installmentRows.forEach((row) => {
        if (!Array.isArray(row) || !codeKey(row[iCode])) return;
        installmentSources += 1;
        sources.push({
          code: row[iCode], name: iName >= 0 ? row[iName] : '',
          center: iCenter >= 0 ? row[iCenter] : '', kind: 'installment',
        });
      });
    }
    if (!sources.length) {
      const readableSource = (bId >= 0 && bValues.length > 0) || iCode >= 0;
      if (!readableSource) return unchanged('active-source-columns-unavailable');
      return {
        headers: [...COMPACT_HEADERS], rows: [], skipped: false,
        stats: { before: oldRows.length, after: 0, removed: oldRows.length, activeSources: 0, activeBalanceRows, installmentSources, matchedSources: 0 },
      };
    }

    const exact = new Map();
    const names = new Map();
    const suffixLengths = new Set();
    sources.forEach((source) => {
      const raw = digits(source.code);
      const key = codeKey(source.code);
      if (raw.length >= 3) suffixLengths.add(raw.length);
      if (key.length >= 3) suffixLengths.add(key.length);
    });
    const suffixes = new Map([...suffixLengths].map((length) => [length, new Map()]));
    oldRows.forEach((row, index) => {
      const raw = digits(row?.[codeIndex]);
      const key = raw.replace(/^0+/, '');
      add(exact, key, index);
      if (nameIndex >= 0) add(names, nameKey(row?.[nameIndex]), index);
      suffixLengths.forEach((length) => {
        if (raw.length >= length) add(suffixes.get(length), raw.slice(-length), index);
      });
    });

    const centerMatches = (index, expectedValue) => {
      const expected = digits(expectedValue);
      if (!expected || centerIndex < 0) return true;
      const actual = digits(String(oldRows[index]?.[centerIndex] || '').split(',')[0]);
      return actual === expected || (expected.length >= 2 && actual.endsWith(expected));
    };
    const disambiguate = (indices, source) => {
      let list = unique(indices);
      if (list.length > 1 && source.center) {
        const byCenter = list.filter((index) => centerMatches(index, source.center));
        if (byCenter.length) list = byCenter;
      }
      if (list.length > 1 && source.name && nameIndex >= 0) {
        const wanted = nameKey(source.name);
        const byName = list.filter((index) => nameKey(oldRows[index]?.[nameIndex]) === wanted);
        if (byName.length) list = byName;
      }
      /* সন্দেহ থাকলে সম্ভাব্য active contact মুছে ফেলি না। */
      return list;
    };

    const keep = new Set();
    let matchedSources = 0;
    sources.forEach((source) => {
      const raw = digits(source.code);
      const key = codeKey(source.code);
      let matches = exact.get(key) || [];
      if (!matches.length && raw.length >= 3) matches = suffixes.get(raw.length)?.get(raw) || [];
      if (!matches.length && key.length >= 3 && key !== raw) matches = suffixes.get(key.length)?.get(key) || [];
      if (matches.length) {
        disambiguate(matches, source).forEach((index) => keep.add(index));
        matchedSources += 1;
        return;
      }
      /* Code বদলে গেলে একমাত্র exact name (+ center) match-ই নিরাপদ fallback। */
      if (source.name && nameIndex >= 0) {
        let byName = unique(names.get(nameKey(source.name)) || []);
        if (source.center) byName = byName.filter((index) => centerMatches(index, source.center));
        if (byName.length === 1) { keep.add(byName[0]); matchedSources += 1; }
      }
    });

    const rows = [...keep].sort((a, b) => a - b).map((index) => {
      const row = oldRows[index] || [];
      return [centerIndex, codeIndex, nameIndex, mobileIndex, guardianIndex]
        .map((column) => column >= 0 ? String(row[column] ?? '').trim() : '');
    });
    return {
      headers: [...COMPACT_HEADERS], rows, skipped: false,
      stats: {
        before: oldRows.length, after: rows.length, removed: oldRows.length - rows.length,
        activeSources: sources.length, activeBalanceRows, installmentSources, matchedSources,
      },
    };
  }

  root.COLLECTION_ACTIVE_MEMBERS = { compactActiveMembers, COMPACT_HEADERS: [...COMPACT_HEADERS] };
})(typeof window !== 'undefined' ? window : globalThis);
