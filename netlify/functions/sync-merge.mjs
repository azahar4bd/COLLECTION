/* Shared, dependency-free patch merge for Netlify and the sandbox preview.
   Entry patches are deliberately ID-based: a stale Today/history array from one
   device must never replace another device's entries. */

const money = (value) => {
  const normalized = String(value ?? '').replace(/[০-৯]/g, (digit) => '০১২৩৪৫৬৭৮৯'.indexOf(digit)).replace(/[৳,\sTk]/gi, '');
  const number = parseFloat(normalized);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(number * 100) / 100;
  return Number.isFinite(rounded) ? rounded : 0;
};
const text = (value) => String(value ?? '').trim();
const digits = (value) => text(value).replace(/\D/g, '');
const memberKey = (value) => digits(value).replace(/^0+/, '');
const norm = (value) => text(value).toLowerCase();
const normHeader = (value) => norm(value).replace(/[^a-z0-9]+/g, '');

function isoDate(value) {
  const source = text(value);
  let match = source.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = source.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  match = source.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (match) return `20${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return '';
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function entrySignature(item) {
  return JSON.stringify([
    item?.date, item?.memberCode, item?.installmentKey,
    item?.createdAt || item?.closedAt,
    item?.loan, item?.savings, item?.dps, item?.total,
  ]);
}

/* Must mirror the browser's deterministic migration IDs for legacy entries. */
function normalizeEntryIds(today, history) {
  const used = new Set();
  const counts = new Map();
  for (const [prefix, list] of [['t', today], ['h', history]]) {
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const signature = entrySignature(item);
      const occurrence = counts.get(signature) || 0;
      counts.set(signature, occurrence + 1);
      if (!item.id) item.id = `${prefix}-${hash(signature + '|' + occurrence)}`;
      item.id = String(item.id);
      if (used.has(item.id)) item.id = `${item.id}-${occurrence + 1}`;
      used.add(item.id);
    }
  }
}

function headerIndex(headers, predicates) {
  const normalized = (Array.isArray(headers) ? headers : []).map(normHeader);
  for (const predicate of predicates) {
    const index = normalized.findIndex(predicate);
    if (index >= 0) return index;
  }
  return -1;
}

function rowColumns(headers) {
  return {
    actual: headerIndex(headers, [
      (h) => h === 'installmentactual' || h === 'actualinstallment',
      (h) => h.includes('actual') && !h.includes('date'),
    ]),
    paidDate: headerIndex(headers, [
      (h) => h === 'installmentdateactual' || h === 'instalmentdateactual',
      (h) => h.includes('paid') && h.includes('date'),
      (h) => h.includes('actual') && h.includes('date'),
    ]),
    member: headerIndex(headers, [
      (h) => h.includes('member') && (h.includes('code') || h.includes('no') || h.includes('id') || h.includes('number')),
      (h) => h === 'memno' || h === 'membercode',
    ]),
    memberName: headerIndex(headers, [
      (h) => h.includes('member') && h.includes('name'),
      (h) => h === 'name',
    ]),
    staffName: headerIndex(headers, [
      (h) => (h.includes('emp') || h.includes('staff') || h.includes('employee')) && h.includes('name'),
    ]),
    staff: headerIndex(headers, [
      (h) => h.includes('employee') || h.includes('staff') || h.includes('empcode'),
    ]),
    center: headerIndex(headers, [
      (h) => h.includes('center') && (h.includes('code') || h.includes('id') || h.includes('no')),
      (h) => h === 'center' || h === 'centercode',
    ]),
    centerName: headerIndex(headers, [
      (h) => (h.includes('center') || h.includes('centre')) && h.includes('name'),
    ]),
    date: headerIndex(headers, [
      (h) => (h.includes('installment') || h.includes('instalment')) && h.includes('date') && !h.includes('actual'),
      (h) => h.includes('due') && h.includes('date'),
    ]),
    amount: headerIndex(headers, [
      (h) => h.includes('installment') && h.includes('amount') && !h.includes('actual'),
      (h) => h === 'amount',
    ]),
    loan: headerIndex(headers, [
      (h) => h === 'loansummaryid' || h === 'loanaccount' || h === 'loanaccountnumber',
    ]),
  };
}

function archiveBaseKey(row, columns) {
  const member = columns.member >= 0 ? memberKey(row[columns.member]) : '';
  const dueDate = columns.date >= 0 ? isoDate(row[columns.date]) || norm(row[columns.date]) : '';
  const center = columns.center >= 0 ? norm(row[columns.center]) : '';
  const amount = columns.amount >= 0 ? money(row[columns.amount]) : 0;
  const loanId = columns.loan >= 0 ? norm(row[columns.loan]) : '';
  if (loanId) return `loan:${loanId}|member:${member}|due:${dueDate}`;
  return `member:${member}|due:${dueDate}|center:${center}|amount:${amount}`;
}

function archiveKeyAt(rows, index, columns) {
  const base = archiveBaseKey(rows[index], columns);
  let occurrence = 0;
  for (let i = 0; i < index; i += 1) {
    if (archiveBaseKey(rows[i], columns) === base) occurrence += 1;
  }
  return `${base}|occ:${occurrence}`;
}

function sameEntryMember(a, b) {
  const aCode = memberKey(a?.memberCode);
  const bCode = memberKey(b?.memberCode);
  if (aCode || bCode) return aCode && bCode && aCode === bCode;
  return norm(a?.memberName) === norm(b?.memberName) && norm(a?.centerCode) === norm(b?.centerCode);
}

function findRowForEntry(rows, columns, entry) {
  if (!rows.length || !entry) return -1;
  if (entry.installmentRef) {
    const exact = rows.findIndex((_, index) => archiveKeyAt(rows, index, columns) === entry.installmentRef);
    if (exact >= 0) return exact;
  }
  const key = memberKey(entry.memberCode);
  if (!key || columns.member < 0) return -1;
  return rows.findIndex((row) => memberKey(row[columns.member]) === key);
}

function applyLoanDelta(rows, headers, entry, delta, touchedRows = null) {
  if (!entry || !Array.isArray(rows) || !rows.length) return -1;
  const columns = rowColumns(headers);
  if (columns.actual < 0) return -1;
  const index = findRowForEntry(rows, columns, entry);
  if (index < 0) return -1;
  if (touchedRows) touchedRows.add(index);
  if (!delta) return index;
  const row = [...rows[index]];
  const actual = money(row[columns.actual]);
  const nextActual = money(Math.max(0, actual + delta));
  row[columns.actual] = String(nextActual);
  if (columns.paidDate >= 0) {
    if (nextActual <= 0) row[columns.paidDate] = '';
    else if (delta > 0 && entry.date) row[columns.paidDate] = String(entry.date).slice(0, 10);
  }
  rows[index] = row;
  return index;
}

function mergeEntries(next, patch) {
  const todayUpserts = Array.isArray(patch.todayUpserts) ? patch.todayUpserts.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const historyUpserts = Array.isArray(patch.historyUpserts) ? patch.historyUpserts.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const todayRemoveIds = new Set((Array.isArray(patch.todayRemoveIds) ? patch.todayRemoveIds : []).map(String));
  const historyRemoveIds = new Set((Array.isArray(patch.historyRemoveIds) ? patch.historyRemoveIds : []).map(String));
  const hasEntryPatch = todayUpserts.length || historyUpserts.length || todayRemoveIds.size || historyRemoveIds.size;
  if (!hasEntryPatch) return null;

  const oldToday = Array.isArray(next.dailyData.todayRows) ? next.dailyData.todayRows.map((item) => ({ ...item })) : [];
  const oldHistory = Array.isArray(next.history) ? next.history.map((item) => ({ ...item })) : [];
  normalizeEntryIds(oldToday, oldHistory);

  const oldById = new Map();
  oldToday.forEach((item) => { if (item.id) oldById.set(String(item.id), item); });
  oldHistory.forEach((item) => { if (item.id) oldById.set(String(item.id), item); });

  const newById = new Map();
  const prepareUpsert = (item, prefix, index) => {
    const copy = { ...item };
    if (!copy.id) copy.id = `${prefix}-${hash(entrySignature(copy) + '|patch|' + index)}`;
    copy.id = String(copy.id);
    newById.set(copy.id, copy);
  };
  todayUpserts.forEach((item, index) => prepareUpsert(item, 't', index));
  historyUpserts.forEach((item, index) => prepareUpsert(item, 'h', index));

  /* Calculate actual/loan deltas before replacing either list. A close operation
     has the same ID in todayRemoveIds and historyUpserts, so its delta is zero. */
  const affected = new Set([...todayRemoveIds, ...historyRemoveIds, ...newById.keys()]);
  const touchedRows = new Set();
  const rows = Array.isArray(next.rows) ? next.rows.map((row) => [...row]) : [];
  for (const id of affected) {
    const oldEntry = oldById.get(String(id));
    const newEntry = newById.get(String(id));
    if (!oldEntry && !newEntry) continue;
    if (oldEntry && newEntry && sameEntryMember(oldEntry, newEntry)) {
      applyLoanDelta(rows, next.headers, newEntry, money(newEntry.loan) - money(oldEntry.loan), touchedRows);
    } else {
      if (oldEntry) applyLoanDelta(rows, next.headers, oldEntry, -money(oldEntry.loan), touchedRows);
      if (newEntry) applyLoanDelta(rows, next.headers, newEntry, money(newEntry.loan), touchedRows);
    }
  }
  next.rows = rows;

  const todayUpsertIds = new Set(todayUpserts.map((item) => String(item.id || '')));
  const historyUpsertIds = new Set(historyUpserts.map((item) => String(item.id || '')));
  /* Include generated IDs as well as client-provided IDs. */
  todayUpserts.forEach((item, index) => {
    if (!item.id) todayUpsertIds.add(`t-${hash(entrySignature(item) + '|patch|' + index)}`);
  });
  historyUpserts.forEach((item, index) => {
    if (!item.id) historyUpsertIds.add(`h-${hash(entrySignature(item) + '|patch|' + index)}`);
  });

  const remainingToday = oldToday.filter((item) => {
    const id = String(item.id || '');
    return !todayRemoveIds.has(id) && !todayUpsertIds.has(id) && !historyUpsertIds.has(id);
  });
  const remainingHistory = oldHistory.filter((item) => {
    const id = String(item.id || '');
    return !historyRemoveIds.has(id) && !historyUpsertIds.has(id) && !todayUpsertIds.has(id);
  });
  const todayNew = todayUpserts.map((item, index) => newById.get(String(item.id || `t-${hash(entrySignature(item) + '|patch|' + index)}`)));
  const historyNew = historyUpserts.map((item, index) => newById.get(String(item.id || `h-${hash(entrySignature(item) + '|patch|' + index)}`)));
  next.dailyData.todayRows = [...todayNew, ...remainingToday];
  next.history = [...historyNew, ...remainingHistory];
  return touchedRows;
}

function mergeStaffDirectory(existing, incoming) {
  const records = new Map();
  const add = (item) => {
    const name = typeof item === 'string' ? item.trim() : text(item?.name);
    if (!name) return;
    if (!records.has(name)) records.set(name, { name, centers: new Set(), members: new Set() });
    const record = records.get(name);
    if (item && typeof item === 'object') {
      (Array.isArray(item.centers) ? item.centers : []).forEach((value) => { if (text(value)) record.centers.add(text(value)); });
      (Array.isArray(item.members) ? item.members : []).forEach((value) => { if (text(value)) record.members.add(text(value)); });
    }
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return [...records.values()].map((record) => ({ name: record.name, centers: [...record.centers].sort(), members: [...record.members].sort() }));
}

function reconcileArchiveRows(next, touchedRows) {
  if (!touchedRows || !touchedRows.size || !Array.isArray(next.rows)) return;
  const columns = rowColumns(next.headers);
  if (columns.actual < 0) return;
  const archive = Array.isArray(next.dailyData.paidArchive) ? [...next.dailyData.paidArchive] : [];
  const byKey = new Map(archive.filter((item) => item?.key).map((item) => [item.key, item]));
  for (const index of touchedRows) {
    if (!Number.isInteger(index) || index < 0 || index >= next.rows.length) continue;
    const row = next.rows[index];
    const key = archiveKeyAt(next.rows, index, columns);
    const previous = byKey.get(key);
    const actual = columns.actual >= 0 ? money(row[columns.actual]) : 0;
    const amount = columns.amount >= 0 ? money(row[columns.amount]) : 0;
    const paid = actual > 0 && (columns.amount < 0 || amount <= 0 || actual >= amount);
    if (!paid) {
      if (previous) byKey.delete(key);
      continue;
    }
    const read = (column) => column >= 0 ? text(row[column]) : '';
    byKey.set(key, {
      key,
      memberCode: read(columns.member),
      memberName: read(columns.memberName),
      centerCode: read(columns.center),
      centerName: read(columns.centerName),
      staffName: read(columns.staffName >= 0 ? columns.staffName : columns.staff) || previous?.staffName || '',
      installmentDate: columns.date >= 0 ? isoDate(row[columns.date]) : '',
      paidDate: (columns.paidDate >= 0 ? isoDate(row[columns.paidDate]) : '') || previous?.paidDate || '',
      amount,
      actual,
      archivedAt: previous?.archivedAt || new Date().toISOString(),
    });
  }
  next.dailyData.paidArchive = [...byKey.values()];
}

export function applyPatch(payload, patch) {
  const next = { ...(payload || {}) };
  if (!next.dailyData || typeof next.dailyData !== 'object' || Array.isArray(next.dailyData)) next.dailyData = {};
  else next.dailyData = { ...next.dailyData };
  if (Array.isArray(patch.headers)) next.headers = patch.headers;
  if (Array.isArray(patch.rows)) next.rows = patch.rows;

  const hasEntryPatch = Boolean(
    (Array.isArray(patch.todayUpserts) && patch.todayUpserts.length)
    || (Array.isArray(patch.historyUpserts) && patch.historyUpserts.length)
    || (Array.isArray(patch.todayRemoveIds) && patch.todayRemoveIds.length)
    || (Array.isArray(patch.historyRemoveIds) && patch.historyRemoveIds.length)
  );
  /* With an entry patch, rowUpdates are only the client's stale view of the
     same loan edit. Recompute deltas against the server's current rows instead. */
  if (!hasEntryPatch && Array.isArray(patch.rowUpdates)) {
    const rows = Array.isArray(next.rows) ? [...next.rows] : [];
    for (const item of patch.rowUpdates) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const index = Number(item[0]);
      const cells = item[1];
      if (!Number.isInteger(index) || index < 0 || index >= rows.length || !Array.isArray(cells)) continue;
      rows[index] = cells;
    }
    next.rows = rows;
  }
  if (Array.isArray(patch.collections)) next.collections = patch.collections;
  if (Array.isArray(patch.followups)) next.followups = patch.followups;

  /* Legacy clients remain supported; new clients use the ID operations below. */
  if (Array.isArray(patch.history)) next.history = patch.history;
  if (Array.isArray(patch.todayRows)) next.dailyData.todayRows = patch.todayRows;
  if (Array.isArray(patch.paidArchive)) next.dailyData.paidArchive = patch.paidArchive;
  const touchedRows = mergeEntries(next, patch);

  if (Array.isArray(patch.paidArchiveUpserts) || Array.isArray(patch.paidArchiveRemoveKeys)) {
    const remove = new Set(Array.isArray(patch.paidArchiveRemoveKeys) ? patch.paidArchiveRemoveKeys : []);
    const archive = Array.isArray(next.dailyData.paidArchive) ? next.dailyData.paidArchive : [];
    const byKey = new Map(archive.filter((item) => item?.key && !remove.has(item.key)).map((item) => [item.key, item]));
    if (Array.isArray(patch.paidArchiveUpserts)) {
      patch.paidArchiveUpserts.forEach((item) => { if (item?.key) byKey.set(item.key, item); });
    }
    next.dailyData.paidArchive = [...byKey.values()];
  }
  reconcileArchiveRows(next, touchedRows);
  if (Array.isArray(patch.staffDirectory)) next.dailyData.staffDirectory = mergeStaffDirectory(next.dailyData.staffDirectory, patch.staffDirectory);
  if (patch.memberDB && Array.isArray(patch.memberDB.rows)) {
    if (Array.isArray(patch.memberDB.headers)) next.dailyData.memberDBHeaders = patch.memberDB.headers;
    next.dailyData.memberDB = patch.memberDB.rows;
  }
  if (patch.balance && Array.isArray(patch.balance.rows)) {
    if (Array.isArray(patch.balance.headers)) next.dailyData.balanceHeaders = patch.balance.headers;
    next.dailyData.balanceRows = patch.balance.rows;
  }
  return next;
}

export { normalizeEntryIds, archiveKeyAt, rowColumns };
