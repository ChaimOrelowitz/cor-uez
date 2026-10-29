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

const port = process.env.PORT || 4100;
app.listen(port, () => console.log(`LDC POC API listening on ${port}`));
startZoneSyncScheduler();
