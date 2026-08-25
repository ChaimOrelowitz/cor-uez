export default async function handler(req, res) {
  try {
    const response = await fetch('https://cor-uez-api.onrender.com/health', {
      headers: { 'user-agent': 'cor-uez-vercel-health-check' }
    });
    const text = await response.text();
    res.status(response.status).setHeader('content-type', response.headers.get('content-type') || 'text/plain').send(text);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}
