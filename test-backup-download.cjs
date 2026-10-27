/* Node: device backup captures current document + pending patches, never secrets. */
const { readFileSync } = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const assert = require('assert');
const appSource = readFileSync(__dirname + '/app.js', 'utf8');
const expectedVersion = appSource.match(/APP_VER\s*=\s*'([^']+)'/)?.[1];
assert(expectedVersion, 'APP_VER পাওয়া যায়নি');

(async () => {
  const dom = new JSDOM(readFileSync(__dirname + '/index.html', 'utf8'), {
    url: 'https://backup.test/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.fetch = async () => { throw new Error('Neon unavailable'); };
  w.confirm = () => true;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const cached = {
    updated_at: '2026-10-25T01:48:18.653Z', headers: [],
    rows: [{ date: '25/10/2026', memberName: 'Cached member', total: 100 }],
    collections: [], followups: [{ id: 'f1', memberName: 'Follow member', promises: [] }],
    dailyData: { memberDB: [{ memberCode: '1', centerCode: '2', memberName: 'Cached member' }],
      balanceRows: [{ memberCode: '1', centerCode: '2', remaining: 500 }],
      todayRows: [{ id: 't1', memberCode: '1', centerCode: '2', memberName: 'Cached member', total: 100 }],
      history: [], paidArchive: [], staffDirectory: [] }, history: [],
  };
  const pendingPatch = { date: '25/10/2026', addedRows: [{ memberName: 'Pending member', total: 200 }] };
  w.localStorage.setItem('collectionManager.fullDoc.v1', JSON.stringify(cached));
  w.localStorage.setItem('collectionManager.offlineOutbox.v1', JSON.stringify([{ id: 'job-1', queuedAt: '2026-10-25T02:00:00.000Z', patch: pendingPatch }]));
  w.eval(appSource + '\n;window.__backupTest={create:createBackupPayload,download:downloadLocalBackup};');
  await new Promise((r) => setTimeout(r, 80));
  const backup = w.__backupTest.create();
  assert.equal(backup.format, 'collection-manager-backup');
  assert.equal(backup.formatVersion, 1);
  assert.equal(backup.appVersion, expectedVersion);
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)));
  assert.equal(backup.document.rows.length, 1);
  assert.equal(backup.document.dailyData.todayRows.length, 1);
  assert.equal(backup.document.followups.length, 1);
  assert.equal(backup.pendingOperationCount, 1);
  assert.deepEqual(backup.pendingOperations[0].patch, pendingPatch);
  assert.equal(backup.pendingOperations[0].document, undefined, 'large duplicate outbox document not exported');
  const serialized = JSON.stringify(backup);
  assert.ok(!serialized.includes('DATABASE_URL'));
  assert.ok(!serialized.includes('collectionManager.settings.v1'));
  assert.ok(!serialized.includes('collectionManager.identity.v1'));

  // Actual Settings button must work without any successful API response.
  w.URL.createObjectURL = () => 'blob:backup-test';
  w.URL.revokeObjectURL = () => {};
  let clicked = null;
  w.HTMLAnchorElement.prototype.click = function () { clicked = this; };
  w.document.querySelector('#btn-download-backup').click();
  assert.ok(clicked, 'backup anchor clicked');
  assert.ok(clicked.download.startsWith('COLLECTION-backup-'));
  assert.ok(clicked.download.endsWith('.json'));
  assert.ok(w.document.querySelector('#backup-status').textContent.includes('Backup download'));
  console.log('পাস: 7   ❌ ফেল: 0 — device backup + offline download');
  w.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
