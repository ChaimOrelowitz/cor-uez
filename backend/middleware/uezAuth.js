const supabase = require('../db/supabase');

async function requireUezAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization token' });

  const token = authHeader.slice('Bearer '.length);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, email, first_name, last_name, phone')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return res.status(403).json({ error: 'Account profile required' });
  if (!['applicant', 'admin'].includes(profile.role)) return res.status(403).json({ error: 'UEZ application access required' });

  req.user = { ...user, ...profile };
  next();
}

function requireUezAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { requireUezAuth, requireUezAdmin };
