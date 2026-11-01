// Shared deadline math for UEZ filings (annual report + recertification are both UEZ filings).
const DAY = 864e5;
function today() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function parse(d) { return d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`) : null; }
function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
function daysBetween(d, now = today()) { return d ? Math.round((d - now) / DAY) : null; }

// Estimate when detail pages haven't synced: filings fall on the certification anniversary.
function nextAnniversary(b, from) {
  const c = parse(b.cert_date);
  if (!c) return null;
  const d = new Date(Date.UTC(from.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
  if (d < from) d.setUTCFullYear(d.getUTCFullYear() + 1);
  while (d <= c) d.setUTCFullYear(d.getUTCFullYear() + 1);
  const filed = [parse(b.last_annual_date), parse(b.last_recert_date)].filter(Boolean).sort((x, y) => y - x)[0];
  if (filed && (d - filed) / DAY < 300) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

// The next UEZ filing due: annual or recert, whichever comes first.
function deadlineFor(b, now = today()) {
  // State status is authoritative: once the state inactivates a business, that supersedes
  // any internal status we'd compute.
  if (b.status === 'I') return { bucket: 'inactive', internal_status: 'inactive', deadline: null, deadline_type: null, days: null, other: null };
  let deadline = null; let type = null; let source = null;
  if (b.on_late_report || b.on_due_report) {
    deadline = parse(b.report_next_due); type = b.report_type; source = 'state_report';
  } else {
    const a = parse(b.next_annual_due); const r = parse(b.next_recert_due);
    if (a || r) {
      if (r && (!a || r <= a)) { deadline = r; type = 'RCRT'; } else { deadline = a; type = 'AR'; }
      source = 'detail';
    } else {
      deadline = nextAnniversary(b, now); type = 'AR'; source = 'estimate';
    }
  }
  const days = deadline ? daysBetween(deadline, now) : null;
  let bucket = 'ok';
  if (b.on_late_report || (days !== null && days < 0)) bucket = 'late';
  else if (days !== null && days <= 30) bucket = 'due_30';
  else if ((days !== null && days <= 60) || b.on_due_report) bucket = 'due_60';
  else if (days !== null && days <= 90) bucket = 'due_90';

  // The *other* filing, if it's also coming up (so Moshe sees "+ recert in 60d").
  let other = null;
  const a = parse(b.next_annual_due); const r = parse(b.next_recert_due);
  if (source === 'detail' && a && r) {
    const otherDate = type === 'RCRT' ? a : r;
    const otherType = type === 'RCRT' ? 'AR' : 'RCRT';
    const od = daysBetween(otherDate, now);
    if (od != null && od >= 0 && otherDate.getTime() !== deadline.getTime()) other = { type: otherType, days: od, date: iso(otherDate) };
  }
  // EZMinder internal status — catches the in-betweeners the state still lists as Active.
  const internal_status = bucket === 'late' ? 'overdue'
    : bucket === 'due_30' ? 'due_soon'
    : (bucket === 'due_60' || bucket === 'due_90') ? 'upcoming'
    : 'current';
  return {
    bucket,
    internal_status,
    deadline: iso(deadline),
    deadline_type: type,
    deadline_source: source,
    days: b.on_late_report && b.report_days_late != null ? -b.report_days_late : days,
    other
  };
}

function isFirstTimer(b) { return b.new_business || (!b.last_annual_date && !b.last_recert_date); }

module.exports = { DAY, today, parse, iso, daysBetween, deadlineFor, isFirstTimer };
