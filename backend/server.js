require('dotenv').config();
const express = require('express');
const cors = require('cors');
const uezRoutes = require('./routes/uez');
const uezAccountsRoutes = require('./routes/uezAccounts');
const uezAnalyticsRoutes = require('./routes/uezAnalytics');
const uezDavRoutes = require('./routes/uezDav');

const app = express();
const allowedOrigins = [
  process.env.UEZ_FRONTEND_URL,
  'https://uez.corsolutions.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean);

// iOS probes CardDAV capabilities with OPTIONS before it has necessarily sent
// Basic Auth credentials. Advertise DAV support here, before the /dav router's
// auth middleware and before cors(), while keeping every data-bearing DAV
// request authenticated inside uezDav.js.
app.options(['/dav', '/dav/*'], (_req, res) => {
  res.set({
    DAV: '1, 2, addressbook',
    Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT',
    'Content-Length': '0'
  }).status(200).end();
});

// CardDAV must be mounted before cors() so DAV methods are not intercepted,
// and before express.json() so PROPFIND/REPORT XML bodies remain untouched for
// the DAV route's own body reader.
app.use('/dav', uezDavRoutes);
app.all('/.well-known/carddav', (_req, res) => res.redirect(301, '/dav/'));

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
