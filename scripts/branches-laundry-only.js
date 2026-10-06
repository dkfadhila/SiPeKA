'use strict';
// Preview by default. No migration, seed, ledger mutation, physical deletion or staff deletion.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot(db, q, keepId, actorId) {
  const keep = await q.unitByIdActive.get(keepId);
  if (!keep || keep.category !== 'LAUNDRY') throw new Error('Explicit keep-id must identify an active LAUNDRY unit');
  if ((await q.userById.get(actorId))?.role !== 'OWNER') throw new Error('Explicit owner-id must identify an Owner');
  const units = await q.allUnitsIncludingArchived.all();
  const users = await q.allUsers.all();
  const counts = await db.prepare(`SELECT
    (SELECT count(*) FROM ledger_transactions) AS transactions,
    (SELECT count(*) FROM cash_closings) AS closings,
    (SELECT count(*) FROM receipt_assets) AS receipts,
    (SELECT count(*) FROM approval_logs) AS approvals`).get();
  const data = { keep_id: keepId, owner_id: actorId, units, users, counts };
  return { ...data, fingerprint: digest(data), archive_ids: units.filter(u => u.is_active === 1 && u.id !== keepId).map(u => u.id).sort() };
}
async function main() {
  const args = process.argv.slice(2);
  const value = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  const allowed = new Set(['--keep-id','--owner-id','--preview-file','--backup-evidence','--confirm','--apply']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('Unknown argument');
    if (args[i] !== '--apply') { if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing argument value'); }
  }
  const keepId = value('--keep-id'), actorId = value('--owner-id'), file = value('--preview-file');
  if (!keepId || !actorId || !file) throw new Error('Required: --keep-id ID --owner-id ID --preview-file PATH');
  if (!process.env.DATABASE_URL) throw new Error('PostgreSQL DATABASE_URL required; no SQLite or fallback');
  const applying = args.includes('--apply');
  const confirmation = 'ARCHIVE_NON_LAUNDRY_KEEP_' + keepId;
  let preview;
  if (applying) {
    if (value('--confirm') !== confirmation) throw new Error('Explicit confirmation required: ' + confirmation);
    const evidence = value('--backup-evidence');
    if (!evidence || !fs.statSync(evidence).isFile() || fs.statSync(evidence).size === 0) throw new Error('Nonempty verified-backup evidence file required');
    preview = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const adapter = require('../db-postgres');
  const { db, q, withRequestTransaction } = adapter;
  try {
    await adapter.ready;
    if (!applying) {
      const plan = await withRequestTransaction(() => snapshot(db, q, keepId, actorId));
      fs.writeFileSync(file, JSON.stringify(plan, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ mode: 'preview', archive_ids: plan.archive_ids, counts: plan.counts, fingerprint: plan.fingerprint }));
      return;
    }
    const result = await withRequestTransaction(async () => {
      const current = await snapshot(db, q, keepId, actorId);
      if (current.fingerprint !== preview.fingerprint || JSON.stringify(current.archive_ids) !== JSON.stringify(preview.archive_ids)) throw new Error('Stale or altered preview; regenerate');
      const results = [];
      for (const id of current.archive_ids) {
        const result = await q.archiveBranch.run(id, actorId, keepId, 'Owner-approved Laundry-only setup; retain financial history for 10 years');
        if (!result.ok) throw new Error('Archive rejected; transaction rolled back');
        results.push(result);
      }
      const after = await snapshot(db, q, keepId, actorId);
      if (after.archive_ids.length || JSON.stringify(after.counts) !== JSON.stringify(current.counts)) throw new Error('Verification failed; transaction rolled back');
      return { mode: 'applied', results, counts: after.counts };
    });
    // Read back exact active targets after commit before reporting success.
    if (JSON.stringify((await q.allUnits.all()).map(u => u.id)) !== JSON.stringify([keepId])) throw new Error('Post-commit verification failed');
    console.log(JSON.stringify(result));
  } finally { await db.close(); }
}
if (require.main === module) main().catch(() => { console.error('Laundry-only operation refused/failed; details suppressed. Check flags, migrations, Owner, backup evidence, preview freshness.'); process.exitCode = 1; });
module.exports = { snapshot, digest };
