// Automated reminder pass. Runs after each sync. For every active business whose next UEZ
// filing is approaching a reminder checkpoint (default 60/30/7 days) and still isn't filed,
// it sends — or, in test mode, just logs — a reminder. Deduped so each business gets each
// checkpoint once. This is what makes the platform "do the chasing."
const supabase = require('../db/supabase');
const { deadlineFor, DAY } = require('./uezDeadline');
const { reminderEmail, sendBusinessEmail, logEmail } = require('./uezEmail');

const COOLDOWN_DAYS = 18; // don't nudge the same business twice inside this window

async function must(q) { const { data, error } = await q; if (error) throw error; return data; }

function checkpointFor(days, windows) {
  if (days == null) return null;
  if (days < 0) return 'late';
  const reached = windows.filter((w) => w >= days).sort((a, b) => a - b);
  return reached.length ? String(reached[0]) : null; // smallest window still ahead of the deadline
}

async function sendDueReminders(org) {
  const windows = (Array.isArray(org.reminder_days) && org.reminder_days.length ? org.reminder_days : [60, 30, 7]).map(Number);
  const rows = await (async () => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const data = await must(supabase.from('uez_zone_businesses').select('*').eq('zone_name', org.zone_name).eq('status', 'A').range(from, from + 999));
      out.push(...data);
      if (data.length < 1000) return out;
    }
  })();

  // Recent reminders, to respect the cooldown.
  const since = new Date(Date.now() - COOLDOWN_DAYS * DAY).toISOString();
  const recent = await must(supabase.from('uez_zone_email_log').select('file_no, created_at').eq('org_id', org.id).like('kind', 'reminder%').gte('created_at', since));
  const recentlyNudged = new Set(recent.map((r) => r.file_no));

  let processed = 0;
  for (const b of rows) {
    const email = b.email || b.report_contact_email;
    if (!email) continue; // no email → it's a call, handled on the home worklist, not here
    const dl = deadlineFor(b);
    const checkpoint = checkpointFor(dl.days, windows);
    if (!checkpoint) continue;
    if (recentlyNudged.has(b.file_no)) continue;

    const biz = { ...b, ...dl, contact_email: email, contact_name: b.owner_name || b.report_contact_name };
    const built = reminderEmail(biz, org);

    if (org.email_live === true) {
      const r = await sendBusinessEmail({ org, biz, built, sender: null });
      if (r.status !== 'failed') processed++;
    } else {
      // Test mode: record the reminder as processed without emailing anyone.
      await logEmail({ org_id: org.id, file_no: b.file_no, kind: built.kind, to_email: email, subject: `[auto ${checkpoint}d] ${built.subject}`, status: 'suppressed' });
      processed++;
    }
    recentlyNudged.add(b.file_no);
  }
  return processed;
}

module.exports = { sendDueReminders };
