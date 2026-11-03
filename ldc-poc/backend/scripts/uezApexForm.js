// Shared helpers for the portal discovery scripts: CLI args and logging in with an org's saved
// portal login. Page submits live in services/uezApexReports.js (also used by the nightly sync).
require('dotenv').config();
const supabase = require('../db/supabase');
const { UezPortal } = require('../services/uezPortal');
const { myNjLogin } = require('../services/uezMyNj');
const { getPortalLogin } = require('../services/uezZoneSync');
const { pageItems, submitPage } = require('../services/uezApexReports');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

async function openScriptPortal() {
  let orgId = arg('org', null);
  if (!orgId) {
    const { data, error } = await supabase.from('uez_zone_portal_logins').select('org_id').eq('status', 'ok').limit(1);
    if (error) throw error;
    orgId = data?.[0]?.org_id;
  }
  if (!orgId) throw new Error('No saved portal login found. Pass --org <orgId>.');
  const creds = await getPortalLogin(orgId);
  if (!creds) throw new Error(`Org ${orgId} has no saved portal login.`);
  const cookies = creds.mynjUsername ? await myNjLogin(creds.mynjUsername, creds.mynjPassword) : [];
  const portal = new UezPortal({ username: creds.username, password: creds.password, cookies, delayMs: 600 });
  const info = await portal.login();
  return { portal, info };
}

module.exports = { arg, clean, openScriptPortal, pageItems, submitPage };
