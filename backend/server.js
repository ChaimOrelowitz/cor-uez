require('dotenv').config();
const express = require('express');
const cors = require('cors');
const uezRoutes = require('./routes/uez');
const uezAccountsRoutes = require('./routes/uezAccounts');
const uezAnalyticsRoutes = require('./routes/uezAnalytics');
const uezDavRoutes = require('./routes/uezDav');
const davBridgeRoutes = require('./routes/davBridge');

const app = express();
const allowedOrigins = [
  process.env.UEZ_FRONTEND_URL,
  'https://uez.corsolutions.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean);

// Proven CardDAV shape used by the working DSC contacts setup.
// The Cloudflare Worker sends OPTIONS/PROPFIND/REPORT here as signed POSTs,
// because Render's edge blocks those DAV verbs before Express sees them.
app.use('/internal/dav-bridge', davBridgeRoutes);

// Direct CardDAV discovery/collection routes. No redirects: authenticated
// CardDAV clients can handle redirects poorly. Keep /dav as a legacy browser
// health alias, but the iPhone/Worker uses /carddav.
app.use('/.well-known/carddav', uezDavRoutes);
app.use('/carddav', uezDavRoutes);
app.use('/dav', uezDavRoutes);
app.options('/', uezDavRoutes);
app.propfind('/', uezDavRoutes);

app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      /\.vercel\.app$/.test(origin) ||
      /^chrome-extension:\/\//.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({
  ok: true,
  service: 'cor-uez-api',
  build: 'chrome-extension-v2'
}));
app.use('/api/uez/analytics', uezAnalyticsRoutes);
app.use('/api/uez', uezAccountsRoutes);
app.use('/api/uez', uezRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`COR UEZ API listening on ${port}`));
