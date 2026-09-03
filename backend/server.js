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

// CardDAV — mounted BEFORE express.json() so the body stream is untouched
// for PROPFIND/REPORT requests that carry XML (not JSON) bodies.
app.use('/dav', uezDavRoutes);
// iOS well-known redirect — redirects to the DAV root so auto-discovery works
app.all('/.well-known/carddav', (_req, res) => res.redirect(301, '/dav/'));

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
