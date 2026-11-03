// One-time history load for the statewide (all-zones) tables. Newest periods first, skips periods
// already loaded (safe to stop and re-run), and logs back in if the portal session drops.
//
//   node scripts/uezStateBackfill.js [--kinds weekly,investment,sic_active,sic_inactive,current]
//                                    [--weeks-from 2023-01-06] [--months-from <date>] [--org <orgId>]
const { arg, openScriptPortal } = require('./uezApexForm');
const S = require('../services/uezStateSync');

async function main() {
  const kinds = String(arg('kinds', 'current,weekly,investment,sic_active,sic_inactive')).split(',');
  const weeksFrom = arg('weeks-from', '2023-01-06');
  const monthsFrom = arg('months-from', null);
  let { portal, info } = await openScriptPortal();
  console.log(`Logged in as ${info.portalUser} (${info.zoneName}).`);

  const tasks = [];
  if (kinds.includes('current')) tasks.push({ kind: 'current', period: 'today', run: () => S.loadCurrent(portal) });
  if (kinds.includes('weekly')) {
    const done = await S.doneSet('activity');
    for (const f of S.fridays(weeksFrom)) if (!done.has(f)) tasks.push({ kind: 'weekly', period: f, run: () => S.loadWeek(portal, f) });
  }
  for (const kind of ['investment', 'sic_active', 'sic_inactive']) {
    if (!kinds.includes(kind)) continue;
    const done = await S.doneSet(kind);
    for (const m of S.monthStarts(monthsFrom && monthsFrom > S.FIRST_MONTH[kind] ? monthsFrom : S.FIRST_MONTH[kind])) {
      if (!done.has(m)) tasks.push({ kind, period: m, run: () => (kind === 'investment' ? S.loadInvestment(portal, m) : S.loadSic(portal, m, kind === 'sic_inactive')) });
    }
  }
  // Interleave kinds so every view gets recent history early.
  const byKind = new Map();
  for (const t of tasks) { if (!byKind.has(t.kind)) byKind.set(t.kind, []); byKind.get(t.kind).push(t); }
  const queue = [];
  for (let i = 0; queue.length < tasks.length; i++) for (const list of byKind.values()) if (list[i]) queue.push(list[i]);
  console.log(`${queue.length} reports to load.`);

  const started = Date.now(); let ok = 0; let failed = 0;
  for (const [i, t] of queue.entries()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await t.run();
        ok++;
        const eta = Math.round(((Date.now() - started) / (i + 1)) * (queue.length - i - 1) / 60000);
        console.log(`[${i + 1}/${queue.length}] ${t.kind} ${t.period}: ${JSON.stringify(res)} (~${eta} min left)`);
        break;
      } catch (e) {
        // A fresh login can't fix a report we couldn't parse, and every extra myNJ login risks
        // tripping its bot check, so only session-type errors get a retry.
        if (attempt === 1 && e.code !== 'parse') {
          console.log(`  ${t.kind} ${t.period}: ${e.message} — logging in again and retrying`);
          await portal.logout().catch(() => {});
          try { ({ portal, info } = await openScriptPortal()); } catch (le) {
            console.log(`\nStopping: could not log in again (${le.message}). Re-run later; loaded periods are skipped.`);
            console.log(`Done so far: ${ok} loaded, ${failed} failed.`);
            return;
          }
          continue;
        }
        failed++;
        console.log(`  ${t.kind} ${t.period}: FAILED ${e.message}`);
        if (t.period !== 'today') await S.logRun(t.kind === 'weekly' ? 'activity' : t.kind, t.period, 'failed', 0, e.message).catch(() => {});
      }
    }
  }
  await portal.logout();
  console.log(`\nDone: ${ok} loaded, ${failed} failed, ${Math.round((Date.now() - started) / 60000)} min.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
