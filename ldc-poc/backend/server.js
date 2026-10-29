// LDC POC: UEZ Zone Dashboard API. Standalone; separate from the signup app's backend.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const zoneRoutes = require('./routes/uezZone');
const { startZoneSyncScheduler } = require('./services/uezZoneSync');

const app = express();
const allowed = [process.env.FRONTEND_URL, 'http://localhost:5173'].filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowed.includes(origin) || /\.vercel\.app$/.test(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'ldc-poc-api' }));
app.use('/api/uez/zone', zoneRoutes);

// Reachability check (no login): can this server load the UEZ login page?
app.get('/health/portal', async (_req, res) => {
  const started = Date.now();
  try {
    const r = await fetch('https://portal03.nj.gov/ords_apex_oit/f?p=404:LOGIN', {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
      signal: AbortSignal.timeout(30000)
    });
    const body = await r.text();
    res.json({ ok: r.ok, status: r.status, ms: Date.now() - started, finalUrl: r.url.replace(/:\d{6,}/g, ':…'), hasLoginForm: body.includes('P101_USERNAME'), sample: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) });
  } catch (e) {
    res.json({ ok: false, ms: Date.now() - started, error: e.cause?.code || e.cause?.message || e.message });
  }
});

const port = process.env.PORT || 4100;
app.listen(port, () => console.log(`LDC POC API listening on ${port}`));
startZoneSyncScheduler();
