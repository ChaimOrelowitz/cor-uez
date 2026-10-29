const supabase = require('../db/supabase');

const FALLBACK_ADMIN_EMAILS = new Set([
  'chaim@corsolutions.io'
]);

async function requireUezAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.slice('Bearer '.length);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const normalizedEmail = String(user.email || '').trim().toLowerCase();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, email, first_name, last_name, phone')
    .eq('id', user.id)
    .maybeSingle();

  // A valid Supabase auth user is enough to enter the UEZ applicant flow.
  // Profiles add metadata and can elevate a user to admin, but a missing or
  // temporarily unreadable profile must never block an authenticated applicant.
  let role = 'applicant';
  if (profile?.role === 'admin' || FALLBACK_ADMIN_EMAILS.has(normalizedEmail)) role = 'admin';
  else if (profile?.role === 'applicant') role = 'applicant';

  req.user = {
    ...user,
    ...(profile || {}),
    id: user.id,
    email: profile?.email || normalizedEmail,
    role
  };

  next();
}

function requireUezAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { requireUezAuth, requireUezAdmin };
