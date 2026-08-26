from pathlib import Path

p = Path('backend/routes/uezBrc.js')
s = p.read_text()

if 'async function addStatusEvent(' not in s:
    anchor = """async function ownedApplication(id, user) {
  let query = supabase.from('uez_applications').select('*').eq('id', id);
  if (user.role !== 'admin') query = query.eq('applicant_user_id', user.id);
  const { data, error } = await query.single();
  if (error || !data) return null;
  return data;
}

"""
    helper = anchor + """async function addStatusEvent(applicationId, status, label, message, userId, visible = true) {
  const { error } = await supabase.from('uez_status_events').insert({
    application_id: applicationId,
    status,
    label,
    message,
    visible_to_applicant: visible,
    created_by: userId || null
  });
  if (error) throw error;
}

"""
    if anchor not in s:
        raise SystemExit('ownedApplication anchor not found')
    s = s.replace(anchor, helper, 1)

# Guardrail: BRC route must define the helper if it calls it.
if 'addStatusEvent(' in s and 'async function addStatusEvent(' not in s:
    raise SystemExit('addStatusEvent is still undefined in uezBrc.js')

p.write_text(s)
