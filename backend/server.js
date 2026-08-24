require('dotenv').config();
const express = require('express');
const cors = require('cors');
const uezRoutes = require('./routes/uez');

const app = express();
const allowedOrigins = [
  process.env.UEZ_FRONTEND_URL,
  'https://uez.corsolutions.io',
  'http://localhost:5173'
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'cor-uez-api' }));
app.use('/api/uez', uezRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`COR UEZ API listening on ${port}`));
