const supabase = require('../db/supabase');

// A step's pill (resolveProcessStep, src/admin/caseLogic.js) prefers a
// manually-set row in uez_process_steps over the value computed from real
// data, with no expiry — so any action that produces fresh, authoritative
// status for a step must clear that step's manual override, or the pill can
// stay stuck on stale information indefinitely (this is exactly what
// happened with uez_enrollment: approving the approval email correctly
// updated uez_application_status, but a stale manual override on that step
// silently kept showing the old value forever). Best-effort — a failure
// here must never undo the real update it's called alongside.
async function clearExplicitProcessStep(applicationId, stepKey) {
  await supabase.from('uez_process_steps').delete()
    .eq('application_id', applicationId)
    .eq('step_key', stepKey)
    .catch(() => {});
}

module.exports = { clearExplicitProcessStep };
