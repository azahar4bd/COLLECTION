import { neon } from '@neondatabase/serverless';
import { applyPatch } from './sync-merge.mjs';

const ROW_ID = 'installments';
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 150_000;
const MAX_COLUMNS = 250;
const MAX_COLLECTIONS = 100_000;
const MAX_FOLLOWUPS = 100_000;
const MAX_DAILY_ROWS = 100_000;
const MAX_HISTORY = 300_000;
const MAX_PAID_ARCHIVE = 300_000;

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
    body: statusCode === 204 ? '' : JSON.stringify(payload),
  };
}

function validCollection(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const text = (value, max = 20_000) => typeof value === 'string' && value.length <= max;
  const money = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!text(item.id, 200) || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) return false;
  if (item.createdAt != null && !text(item.createdAt, 100)) return false;
  if (item.updatedAt != null && !text(item.updatedAt, 100)) return false;
  if (item.installmentKey != null && !text(item.installmentKey, 500)) return false;
  if (!['memberCode', 'memberName', 'mobile'].every((key) => text(item[key] ?? '', 2_000))) return false;
  if (!['loan', 'savings', 'dps', 'total'].every((key) => money(item[key]))) return false;
  if (item.memberDetails != null && (!Array.isArray(item.memberDetails)
      || item.memberDetails.length > MAX_COLUMNS
      || !item.memberDetails.every((detail) => detail && typeof detail === 'object' && !Array.isArray(detail)
        && text(detail.label, 2_000) && text(detail.value, 20_000)))) return false;
  return true;
}

function validFollowup(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const text = (value, max = 3_000) => typeof value === 'string' && value.length <= max;
  return text(item.key, 300) && item.key.length > 0
    && text(item.memberCode, 2_000)
    && text(item.memberName ?? '', 2_000)
    && text(item.promise ?? '', 3_000)
    && text(item.nextDate ?? '', 10)
    && (!item.nextDate || /^\d{4}-\d{2}-\d{2}$/.test(item.nextDate))
    && (item.updatedAt == null || text(item.updatedAt, 100));
}

function validHistoryEntry(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const text = (value, max = 2_000) => typeof value === 'string' && value.length <= max;
  const money = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return text(item.id, 200)
    && /^\d{4}-\d{2}-\d{2}$/.test(item.date || '')
    && (item.closeDate == null || /^\d{4}-\d{2}-\d{2}$/.test(item.closeDate))
    && (item.closedAt == null || text(item.closedAt, 100))
    && (item.kind === 'monthly' || item.kind === 'other')
    && text(item.memberCode ?? '', 2_000)
    && text(item.centerCode ?? '', 2_000)
    && text(item.memberName ?? '', 2_000)
    && (item.installmentKey == null || text(item.installmentKey, 500))
    && ['loan', 'savings', 'dps', 'total'].every((key) => money(item[key]));
}

function validPaidArchiveEntry(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const text = (value, max = 2_000) => typeof value === 'string' && value.length <= max;
  const date = (value) => value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const money = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return text(item.key, 1_000) && item.key.length > 0
    && ['memberCode', 'memberName', 'centerCode', 'centerName', 'staffName'].every((key) => text(item[key] ?? ''))
    && date(item.installmentDate || '') && date(item.paidDate || '')
    && money(item.amount) && money(item.actual)
    && text(item.archivedAt, 100) && item.archivedAt.length > 0;
}

function validDailyData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const headers = [data.memberDBHeaders, data.balanceHeaders];
  const rows = [data.memberDB, data.balanceRows];
  if (!headers.every(list => Array.isArray(list) && list.length <= MAX_COLUMNS && list.every(value => typeof value === 'string' && value.length <= 2_000))) return false;
  if (!rows.every((list, index) => Array.isArray(list) && list.length <= MAX_DAILY_ROWS
      && list.every(row => Array.isArray(row) && row.length <= MAX_COLUMNS + (index === 1 ? 1 : 0)
        && row.every(cell => cell === null || ['string', 'number', 'boolean'].includes(typeof cell))))) return false;
  if (!Array.isArray(data.todayRows) || data.todayRows.length > MAX_DAILY_ROWS) return false;
  if (data.paidArchive != null && (!Array.isArray(data.paidArchive)
      || data.paidArchive.length > MAX_PAID_ARCHIVE
      || !data.paidArchive.every(validPaidArchiveEntry))) return false;
  if (data.staffDirectory != null && (!Array.isArray(data.staffDirectory) || data.staffDirectory.length > 20_000
      || !data.staffDirectory.every((item) => typeof item === 'string' ? item.length <= 2_000
        : item && typeof item === 'object' && !Array.isArray(item) && typeof item.name === 'string' && item.name.length <= 2_000
          && (item.centers == null || (Array.isArray(item.centers) && item.centers.length <= 100_000 && item.centers.every((value) => typeof value === 'string' && value.length <= 100)))
          && (item.members == null || (Array.isArray(item.members) && item.members.length <= 100_000 && item.members.every((value) => typeof value === 'string' && value.length <= 100)))))) return false;
  return data.todayRows.every(item => item && typeof item === 'object' && !Array.isArray(item)
    && ['memberCode', 'centerCode', 'memberName'].every(key => typeof item[key] === 'string' && item[key].length <= 2_000)
    && ['loan', 'savings', 'dps', 'total'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0)
    && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    && (item.createdAt == null || (typeof item.createdAt === 'string' && item.createdAt.length <= 100))
    && (item.memberIndex == null || (Number.isInteger(item.memberIndex) && item.memberIndex >= -1)));
}

function parseDocument(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  if (raw.byteLength > MAX_BODY_BYTES) {
    return { error: jsonResponse(413, { error: 'Upload is too large (maximum 5 MB).' }) };
  }

  let input;
  try {
    input = JSON.parse(raw.toString('utf8'));
  } catch {
    return { error: jsonResponse(400, { error: 'Request body must be valid JSON.' }) };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)
      || !Array.isArray(input.headers) || !Array.isArray(input.rows)) {
    return { error: jsonResponse(400, { error: 'Expected { headers: string[], rows: unknown[][], collections?: object[] }.' }) };
  }
  if (input.headers.length > MAX_COLUMNS || !input.headers.every((value) => typeof value === 'string')) {
    return { error: jsonResponse(400, { error: `Headers must be strings; maximum ${MAX_COLUMNS} columns.` }) };
  }
  if (input.rows.length > MAX_ROWS || !input.rows.every((row) =>
    Array.isArray(row)
      && row.length <= MAX_COLUMNS
      && row.every((cell) => cell === null || ['string', 'number', 'boolean'].includes(typeof cell))
  )) {
    return { error: jsonResponse(400, { error: `Rows are invalid; maximum ${MAX_ROWS} rows and ${MAX_COLUMNS} columns.` }) };
  }
  if (input.collections != null && (!Array.isArray(input.collections)
      || input.collections.length > MAX_COLLECTIONS
      || !input.collections.every(validCollection))) {
    return { error: jsonResponse(400, { error: `Collections are invalid; maximum ${MAX_COLLECTIONS} valid collection records.` }) };
  }
  if (input.followups != null && (!Array.isArray(input.followups)
      || input.followups.length > MAX_FOLLOWUPS
      || !input.followups.every(validFollowup))) {
    return { error: jsonResponse(400, { error: `Follow-ups are invalid; maximum ${MAX_FOLLOWUPS} valid records.` }) };
  }
  if (input.dailyData != null && !validDailyData(input.dailyData)) {
    return { error: jsonResponse(400, { error: 'Daily member, balance, or collection data is invalid.' }) };
  }
  if (input.history != null && (!Array.isArray(input.history)
      || input.history.length > MAX_HISTORY
      || !input.history.every(validHistoryEntry))) {
    return { error: jsonResponse(400, { error: `Closed-account history is invalid; maximum ${MAX_HISTORY} records.` }) };
  }

  return { document: {
    headers: input.headers,
    rows: input.rows,
    collections: input.collections,
    followups: input.followups,
    dailyData: input.dailyData,
    hasDailyData: input.dailyData != null,
    history: input.history,
    hasHistory: Array.isArray(input.history),
    hasCollections: Array.isArray(input.collections),
    hasFollowups: Array.isArray(input.followups),
  } };
}

/* ---------- হালকা মেটা (প্রতি ৮–১০ সেকেন্ডে পোল করার জন্য) ---------- */
function summarize(payload, updatedAt) {
  const daily = payload?.dailyData || {};
  const today = Array.isArray(daily.todayRows) ? daily.todayRows.length : 0;
  return {
    updated_at: updatedAt || null,
    counts: {
      rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      members: Array.isArray(daily.memberDB) ? daily.memberDB.length : 0,
      balances: Array.isArray(daily.balanceRows) ? daily.balanceRows.length : 0,
      today: today,
      collections: Array.isArray(payload?.collections) ? payload.collections.length : 0,
      followups: Array.isArray(payload?.followups) ? payload.followups.length : 0,
      history: Array.isArray(payload?.history) ? payload.history.length : 0,
      paidArchive: Array.isArray(daily.paidArchive) ? daily.paidArchive.length : 0,
    },
  };
}

/* ---------- আংশিক লেখা: শুধু বদলানো অংশ Neon-এ মেলানো ----------
   এতে একটি এন্ট্রি সেভে ~৯৫০ KB-এর বদলে কয়েকশো বাইট যায়। */
export const handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'PUT' && method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, { Allow: 'GET, PUT, POST' });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return jsonResponse(503, { error: 'Server setup incomplete: DATABASE_URL is not configured.' });
  }

  try {
    const sql = neon(databaseUrl);

    const wantsMeta = ['1', 'true', 'yes'].includes(String(event.queryStringParameters?.meta ?? '').toLowerCase());

    if (method === 'GET' && wantsMeta) {
      const result = await sql`
        SELECT payload, updated_at
        FROM collection_app_state
        WHERE id = ${ROW_ID}
        LIMIT 1
      `;
      if (!result.length) return jsonResponse(200, { ...summarize({}, null), empty: true });
      const payload = typeof result[0].payload === 'string' ? JSON.parse(result[0].payload) : result[0].payload;
      return jsonResponse(200, summarize(payload, result[0].updated_at));
    }

    if (method === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { body = null; }
      const patch = body && body.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return jsonResponse(400, { error: 'Expected { patch: { … } }.' });
      }
      if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
        return jsonResponse(413, { error: 'Patch body too large.' });
      }
      /* Conditional write + retry: simultaneous devices must not overwrite one
         another between SELECT and UPDATE. Each retry reapplies the same patch
         to the newest server document. */
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await sql`
          SELECT payload, updated_at, updated_at::text AS updated_at_lock
          FROM collection_app_state WHERE id = ${ROW_ID} LIMIT 1
        `;
        const payload = current.length
          ? (typeof current[0].payload === 'string' ? JSON.parse(current[0].payload) : current[0].payload)
          : {};
        const nextPayload = applyPatch(payload, patch);
        const serialized = JSON.stringify(nextPayload);
        const saved = current.length ? await sql`
          UPDATE collection_app_state
          SET payload = ${serialized}::jsonb, updated_at = now()
          /* timestamptz-এর microseconds JavaScript Date-এ নেই। Text lock না দিলে
             precision কমে যায় এবং প্রতিটি conditional update ভুল 409 দেয়। */
          WHERE id = ${ROW_ID} AND updated_at::text IS NOT DISTINCT FROM ${current[0].updated_at_lock}
          RETURNING updated_at
        ` : await sql`
          INSERT INTO collection_app_state (id, payload, updated_at)
          VALUES (${ROW_ID}, ${serialized}::jsonb, now())
          ON CONFLICT (id) DO NOTHING
          RETURNING updated_at
        `;
        if (saved.length) {
          const out = summarize(nextPayload, saved[0]?.updated_at || new Date().toISOString());
          return jsonResponse(200, { ok: true, ...out });
        }
      }
      return jsonResponse(409, { error: 'একই সময়ে অন্য device আপডেট করছে—অপারেশনটি আবার sync করার চেষ্টা হবে।' });
    }

    if (method === 'GET') {
      const result = await sql`
        SELECT payload, updated_at
        FROM collection_app_state
        WHERE id = ${ROW_ID}
        LIMIT 1
      `;
      if (!result.length) {
        return jsonResponse(200, { headers: [], rows: [], collections: [], followups: [], dailyData: null, history: [], updated_at: null });
      }

      const payload = typeof result[0].payload === 'string'
        ? JSON.parse(result[0].payload)
        : result[0].payload;
      return jsonResponse(200, {
        headers: Array.isArray(payload?.headers) ? payload.headers : [],
        rows: Array.isArray(payload?.rows) ? payload.rows : [],
        collections: Array.isArray(payload?.collections) ? payload.collections : [],
        followups: Array.isArray(payload?.followups) ? payload.followups : [],
        dailyData: payload?.dailyData && typeof payload.dailyData === 'object' ? payload.dailyData : null,
        history: Array.isArray(payload?.history) ? payload.history : [],
        updated_at: result[0].updated_at || null,
      });
    }

    const parsed = parseDocument(event);
    if (parsed.error) return parsed.error;
    const { headers, rows, collections, followups, dailyData, hasCollections, hasFollowups, hasDailyData, history, hasHistory } = parsed.document;
    const inputPayload = JSON.stringify({
      headers,
      rows,
      ...(hasCollections ? { collections } : {}),
      ...(hasFollowups ? { followups } : {}),
      ...(hasDailyData ? { dailyData } : {}),
      ...(hasHistory ? { history } : {}),
    });
    const result = await sql`
      INSERT INTO collection_app_state (id, payload, updated_at)
      VALUES (${ROW_ID}, ${inputPayload}::jsonb, now())
      ON CONFLICT (id) DO UPDATE
        SET payload = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    EXCLUDED.payload,
                    '{collections}',
                    CASE WHEN ${hasCollections}
                      THEN COALESCE(EXCLUDED.payload->'collections', '[]'::jsonb)
                      ELSE COALESCE(collection_app_state.payload->'collections', '[]'::jsonb) END,
                    true
                  ),
                  '{followups}',
                  CASE WHEN ${hasFollowups}
                    THEN COALESCE(EXCLUDED.payload->'followups', '[]'::jsonb)
                    ELSE COALESCE(collection_app_state.payload->'followups', '[]'::jsonb) END,
                  true
                ),
                '{dailyData}',
                CASE WHEN ${hasDailyData}
                  THEN COALESCE(EXCLUDED.payload->'dailyData', 'null'::jsonb)
                  ELSE COALESCE(collection_app_state.payload->'dailyData', 'null'::jsonb) END,
                true
              ),
              '{history}',
              CASE WHEN ${hasHistory}
                THEN COALESCE(EXCLUDED.payload->'history', '[]'::jsonb)
                ELSE COALESCE(collection_app_state.payload->'history', '[]'::jsonb) END,
              true
            ),
            updated_at = now()
      RETURNING payload, updated_at
    `;
    const savedPayload = typeof result[0]?.payload === 'string'
      ? JSON.parse(result[0].payload)
      : result[0]?.payload || { headers, rows, collections: collections || [] };

    return jsonResponse(200, {
      headers: Array.isArray(savedPayload.headers) ? savedPayload.headers : headers,
      rows: Array.isArray(savedPayload.rows) ? savedPayload.rows : rows,
      collections: Array.isArray(savedPayload.collections) ? savedPayload.collections : [],
      followups: Array.isArray(savedPayload.followups) ? savedPayload.followups : [],
      dailyData: savedPayload.dailyData && typeof savedPayload.dailyData === 'object' ? savedPayload.dailyData : null,
      history: Array.isArray(savedPayload.history) ? savedPayload.history : [],
      updated_at: result[0]?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    // Do not return DB errors or secrets to browsers; details stay in Netlify logs.
    console.error('[neon-data] Database operation failed:', error?.message || String(error));
    return jsonResponse(500, { error: 'Neon database request failed. Check the table setup and Netlify function logs.' });
  }
};
