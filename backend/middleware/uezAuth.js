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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, email, first_name, last_name, phone')
    .eq('id', user.id)
    .maybeSingle();

  // The authenticated Supabase user is authoritative for identity. If the
  // profile lookup itself fails, do not lock the verified COR administrator
  // out of the UEZ console. This fallback is intentionally restricted to the
  // known admin email and does not grant applicant access to arbitrary users.
  if (profileError || !profile) {
    if (FALLBACK_ADMIN_EMAILS.has(normalizedEmail)) {
      req.user = {
        ...user,
        id: user.id,
        email: normalizedEmail,
        role: 'admin',
        profileFallback: true
      };
      return next();
    }

    return res.status(403).json({
      error: 'Account profile required',
      code: 'UEZ_PROFILE_REQUIRED_V2'
    });
  }

  if (!['applicant', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'UEZ application access required' });
  }

  req.user = { ...user, ...profile };
  next();
}

function requireUezAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { requireUezAuth, requireUezAdmin };
