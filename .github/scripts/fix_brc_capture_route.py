from pathlib import Path

path = Path('backend/routes/uezBrc.js')
s = path.read_text()

old = """router.post('/:id/admin/captured-certificate', requireUezAdmin, async (req, res) => {
  let browser;
  try {
    if (!verifyExtensionKey(req)) {
      return res.status(403).json({ error: 'Invalid COR extension authorization key.' });
    }
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!html) {
      return res.status(400).json({ error: 'The captured BRC certificate HTML was empty.' });
    }
    if (!result || !result.certificateNumber) {
      const parsed = parseBrcCertificateHtml(html);
      result = { ...parsed, ...result, certificateNumber: parsed.certificateNumber || 'CONFIRMED' };
    }

    let pdf;
    try {
      browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
      pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });
    } catch (err) {
      console.error('Playwright PDF render error, falling back to HTML payload:', err.message);
      pdf = Buffer.from(html, 'utf-8');
    }

    const safeCertificate = String(result.certificateNumber || 'captured').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    const isPdf = pdf && pdf.subarray(0, 5).toString('ascii') === '%PDF-';
    const extension = isPdf ? 'pdf' : 'html';
    const contentType = isPdf ? 'application/pdf' : 'text/html';
    const filename = `NJ-BRC-${safeCertificate}.${extension}`;
"""

new = """router.post('/:id/admin/captured-certificate', requireUezAdmin, async (req, res) => {
  let browser;
  try {
    if (!verifyExtensionKey(req)) {
      return res.status(403).json({ error: 'Invalid COR extension authorization key.' });
    }
    const application = await ownedApplication(req.params.id, req.user);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const html = typeof req.body?.html === 'string' ? req.body.html.trim() : '';
    const result = req.body?.result && typeof req.body.result === 'object' ? { ...req.body.result } : {};
    if (!html) {
      return res.status(400).json({ error: 'The captured BRC certificate HTML was empty.' });
    }
    if (!result.certificateNumber) {
      return res.status(400).json({ error: 'The captured BRC certificate number was missing.' });
    }

    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });
    if (!pdf || pdf.length < 100 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('COR could not render the BRC certificate as a valid PDF.');
    }

    const safeCertificate = String(result.certificateNumber).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    const contentType = 'application/pdf';
    const filename = `NJ-BRC-${safeCertificate}.pdf`;
"""

if old not in s:
    raise SystemExit('BRC captured-certificate route anchor not found')

s = s.replace(old, new, 1)
path.write_text(s)
