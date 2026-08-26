from pathlib import Path

# ---------- src/App.jsx ----------
p = Path('src/App.jsx')
s = p.read_text()
s = s.replace('<main className="page-wrap">', '<main className={`page-wrap intake-page ${step === 0 ? \'intake-first-screen\' : \'\'}`}>', 1)
s = s.replace('<h1>We’ll guide you through the process.</h1>', '<h1>We handle your UEZ signup and grant application.</h1>', 1)
s = s.replace('<p>Start with your business address. We’ll identify your UEZ zone and show you which programs are available.</p>', '<p>Start with your business address. COR will check eligibility, collect what we need, and handle the applications for you.</p>', 1)
p.write_text(s)

# ---------- src/styles.css ----------
p = Path('src/styles.css')
s = p.read_text()
s += r'''

/* Applicant landing: one-screen first impression */
.intake-first-screen{padding-top:24px;padding-bottom:28px}.intake-first-screen .hero{margin-bottom:16px}.intake-first-screen .hero .eyebrow{margin-bottom:8px}.intake-first-screen .hero h1{font-size:clamp(31px,4.2vw,44px)}.intake-first-screen .hero p{margin-top:10px;font-size:15px;line-height:1.5}.intake-first-screen .wizard-head{padding:18px 26px 12px}.intake-first-screen .wizard-head h2{font-size:22px}.intake-first-screen .progress-row{padding:0 26px 16px}.intake-first-screen .content-block{min-height:0;padding:22px 26px 18px}.intake-first-screen .wizard-footer{padding:14px 26px 18px}.intake-first-screen .address-autocomplete label{margin-top:8px}.intake-first-screen .uez-map{height:260px}

/* Action tiles never resize when state/color changes */
.clean-action-grid{grid-auto-rows:72px;align-content:start}.clean-action-grid .ops-action,.clean-action-grid .ops-action.primary,.clean-action-grid .ops-action.success-action,.clean-action-grid .ops-action.ready-action{height:72px!important;min-height:72px!important;max-height:72px!important;margin:0!important;padding:9px 10px!important;border-width:1px!important;box-shadow:none!important;transform:none!important;box-sizing:border-box!important}.clean-action-grid .ops-action span{margin:0 0 4px!important}.clean-action-grid .ops-action strong{margin:0!important;line-height:1.15!important}
@media(max-width:760px){.intake-first-screen{padding-top:14px}.intake-first-screen .hero{margin-bottom:12px}.intake-first-screen .hero h1{font-size:29px}.intake-first-screen .hero p{font-size:14px}.intake-first-screen .wizard-head{padding:15px 18px 10px}.intake-first-screen .progress-row{padding:0 18px 12px}.intake-first-screen .content-block{padding:18px}.intake-first-screen .wizard-footer{padding:12px 18px 16px}.clean-action-grid{grid-auto-rows:68px}.clean-action-grid .ops-action,.clean-action-grid .ops-action.primary,.clean-action-grid .ops-action.success-action,.clean-action-grid .ops-action.ready-action{height:68px!important;min-height:68px!important;max-height:68px!important}}
'''
p.write_text(s)

# ---------- brc-helper-extension/content.js ----------
p = Path('brc-helper-extension/content.js')
s = p.read_text()

# Add helper to identify the exact certificate box.
anchor = "  const notice = (message) => {\n"
helper = r'''  const certificateElement = () => {
    const candidates = [...document.querySelectorAll('table, div, section, fieldset, form, main')]
      .filter((element) => {
        if (element.id === 'cor-uez-helper-notice' || element.closest('#cor-uez-helper-notice')) return false;
        const text = String(element.innerText || '');
        if (!/BUSINESS REGISTRATION CERTIFICATE/i.test(text) || !/Certificate\s*Number/i.test(text)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 350 && rect.height >= 180;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, area: rect.width * rect.height };
      })
      .sort((a, b) => a.area - b.area);
    return candidates[0]?.element || null;
  };

'''+anchor
if 'const certificateElement = () =>' not in s:
    if anchor not in s: raise SystemExit('certificate helper anchor missing')
    s = s.replace(anchor, helper, 1)

old = """        const certificateHtml = await cleanCertificateHtml();

        notice('COR found the official BRC certificate! Saving a clean certificate PDF…');
        await send({
          type: 'COR_BRC_FOUND',
          result: { taxpayerName, tradeName, address, certificateNumber, effectiveDate, issuanceDate },
          html: certificateHtml
        });
        return;
"""
new = """        const certificate = certificateElement();
        if (!certificate) throw new Error('COR could not isolate the NJ certificate on the result page.');
        const helperNotice = document.getElementById('cor-uez-helper-notice');
        if (helperNotice) helperNotice.style.display = 'none';
        certificate.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((resolve) => setTimeout(resolve, 180));
        const rect = certificate.getBoundingClientRect();
        const capture = await send({
          type: 'COR_BRC_CAPTURE_REQUEST',
          result: { taxpayerName, tradeName, address, certificateNumber, effectiveDate, issuanceDate },
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          viewport: { width: window.innerWidth, height: window.innerHeight }
        });
        if (!capture?.ok) throw new Error(capture?.error || 'COR could not capture the NJ certificate.');
        return;
"""
if old not in s: raise SystemExit('old BRC send block missing')
s = s.replace(old, new, 1)
p.write_text(s)

# ---------- brc-helper-extension/background.js ----------
p = Path('brc-helper-extension/background.js')
s = p.read_text()

# Utility for Blob -> base64.
anchor = "async function uploadPdf(job, documentType, base64, filename) {\n"
util = r'''async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function cropVisibleTabCapture(windowId, rect, viewport) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scaleX = bitmap.width / Math.max(1, Number(viewport?.width || bitmap.width));
  const scaleY = bitmap.height / Math.max(1, Number(viewport?.height || bitmap.height));
  const sx = Math.max(0, Math.round(Number(rect?.left || 0) * scaleX));
  const sy = Math.max(0, Math.round(Number(rect?.top || 0) * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(Number(rect?.width || bitmap.width) * scaleX)));
  const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(Number(rect?.height || bitmap.height) * scaleY)));
  const canvas = new OffscreenCanvas(sw, sh);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close?.();
  return blobToBase64(await canvas.convertToBlob({ type: 'image/png' }));
}

'''+anchor
if 'async function cropVisibleTabCapture' not in s:
    if anchor not in s: raise SystemExit('background helper anchor missing')
    s = s.replace(anchor, util, 1)

# New screenshot capture message before old COR_BRC_FOUND handling.
anchor = """    if (message?.type === 'COR_BRC_FOUND') {
"""
handler = """    if (message?.type === 'COR_BRC_CAPTURE_REQUEST') {
      if (job.workflow !== 'brc') return { ok: false, error: 'No matching BRC workflow is active.' };
      await notify(job, 'saving_brc');
      try {
        const windowId = sender.tab?.windowId || job.windowId;
        if (!windowId) throw new Error('COR could not identify the BRC browser window.');
        const screenshotBase64 = await cropVisibleTabCapture(windowId, message.rect, message.viewport);
        await api(job, `/api/uez/brc/${job.applicationId}/admin/captured-certificate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: message.result, screenshotBase64 })
        });
        await notify(job, 'complete');
        if (job.windowId) setTimeout(() => chrome.windows.remove(job.windowId).catch(() => {}), 1200);
        await setJob(null);
        return { ok: true };
      } catch (err) {
        await fail(job, err);
        await setJob(null);
        return { ok: false, error: err.message };
      }
    }
"""+anchor
if 'COR_BRC_CAPTURE_REQUEST' not in s:
    if anchor not in s: raise SystemExit('BRC found handler anchor missing')
    s = s.replace(anchor, handler, 1)
p.write_text(s)

# ---------- backend/routes/uezBrc.js ----------
p = Path('backend/routes/uezBrc.js')
s = p.read_text()
old = """    const html = typeof req.body?.html === 'string' ? req.body.html.trim() : '';
    const result = req.body?.result && typeof req.body.result === 'object' ? { ...req.body.result } : {};
    if (!html) {
      return res.status(400).json({ error: 'The captured BRC certificate HTML was empty.' });
    }
    if (!result.certificateNumber) {
      return res.status(400).json({ error: 'The captured BRC certificate number was missing.' });
    }

    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => Array.from(document.images || []).every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });
"""
new = """    const html = typeof req.body?.html === 'string' ? req.body.html.trim() : '';
    const screenshotBase64 = typeof req.body?.screenshotBase64 === 'string' ? req.body.screenshotBase64.trim() : '';
    const result = req.body?.result && typeof req.body.result === 'object' ? { ...req.body.result } : {};
    if (!html && !screenshotBase64) {
      return res.status(400).json({ error: 'The captured BRC certificate was empty.' });
    }
    if (!result.certificateNumber) {
      return res.status(400).json({ error: 'The captured BRC certificate number was missing.' });
    }

    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    const page = await browser.newPage({ javaScriptEnabled: false });
    if (screenshotBase64) {
      let imageBuffer;
      try { imageBuffer = Buffer.from(screenshotBase64, 'base64'); } catch (_) { imageBuffer = null; }
      if (!imageBuffer || imageBuffer.length < 100 || imageBuffer.subarray(1, 4).toString('ascii') !== 'PNG') {
        return res.status(400).json({ error: 'The captured BRC screenshot was not a valid PNG.' });
      }
      await page.setContent(`<!doctype html><html><head><style>@page{size:Letter;margin:.35in}html,body{margin:0;padding:0;background:#fff}body{display:flex;align-items:flex-start;justify-content:center}img{display:block;max-width:100%;height:auto}</style></head><body><img src=\"data:image/png;base64,${screenshotBase64}\"></body></html>`, { waitUntil: 'load', timeout: 15000 });
    } else {
      await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
      await page.waitForFunction(() => Array.from(document.images || []).every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
    }
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });
"""
if old not in s: raise SystemExit('captured certificate renderer anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)

# ---------- manifest ----------
p = Path('brc-helper-extension/manifest.json')
s = p.read_text().replace('"version": "1.3.2"', '"version": "1.3.3"')
p.write_text(s)
