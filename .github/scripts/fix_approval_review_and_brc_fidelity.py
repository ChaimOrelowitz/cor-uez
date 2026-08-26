from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label}: anchor not found in {path}')
    p.write_text(s.replace(old, new, 1))

# ---------------- backend/routes/uez.js ----------------
p = Path('backend/routes/uez.js')
s = p.read_text()

# Dedicated review endpoint. This avoids overloading the generic process-flags endpoint
# and guarantees that the reviewed file exists and is of the expected type.
anchor = "router.patch('/admin/applications/:id/process-flags', requireUezAdmin, async (req, res) => {\n"
review_route = """router.post('/admin/applications/:id/documents/:documentId/review', requireUezAdmin, async (req, res) => {
  try {
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Review decision must be approved or rejected.' });
    }

    const { data: application, error: appError } = await supabase.from('uez_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (appError || !application) return res.status(404).json({ error: 'Application not found' });

    const { data: document, error: docError } = await supabase.from('uez_documents')
      .select('id, document_type, filename')
      .eq('id', req.params.documentId)
      .eq('application_id', application.id)
      .single();
    if (docError || !document) return res.status(404).json({ error: 'Document not found' });

    const now = new Date().toISOString();
    let patch = { updated_at: now };
    let eventStatus;
    let eventLabel;

    if (document.document_type === 'formation') {
      if (application.is_sole_proprietorship) return res.status(400).json({ error: 'Formation review is not required for a sole proprietorship.' });
      patch.formation_review_status = decision;
      eventStatus = decision === 'approved' ? 'formation_approved' : 'formation_rejected';
      eventLabel = decision === 'approved' ? 'Certificate of Formation approved' : 'Certificate of Formation needs replacement';
    } else if (document.document_type === 'uez_approval_email') {
      patch.uez_approval_review_status = decision;
      patch.uez_application_status = decision === 'approved' ? 'approved' : 'applied';
      patch.uez_application_submitted = true;
      eventStatus = decision === 'approved' ? 'uez_approval_approved' : 'uez_approval_rejected';
      eventLabel = decision === 'approved' ? 'UEZ approval confirmed' : 'UEZ approval document needs replacement';
    } else {
      return res.status(400).json({ error: 'This document does not require admin review.' });
    }

    const { data: updated, error: updateError } = await supabase.from('uez_applications')
      .update(patch)
      .eq('id', application.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await addStatusEvent(
      application.id,
      eventStatus,
      eventLabel,
      decision === 'approved'
        ? `${document.filename} was reviewed and approved by COR.`
        : `${document.filename} was reviewed and marked as the wrong document.`,
      req.user.id,
      false
    );

    res.json({ application: updated, document, decision });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

""" + anchor
if "documents/:documentId/review" not in s:
    if anchor not in s: raise SystemExit('process flags anchor missing')
    s = s.replace(anchor, review_route, 1)

# Admin list readiness: UEZ approval only counts once reviewed/approved.
old = """        + (types.has('brc') ? 1 : 0)
        + (types.has('uez_approval_email') ? 1 : 0)
        + (types.has('tax_clearance') ? 1 : 0)
"""
new = """        + (types.has('brc') ? 1 : 0)
        + (types.has('uez_approval_email') && row.uez_approval_review_status === 'approved' ? 1 : 0)
        + (types.has('tax_clearance') ? 1 : 0)
"""
if old in s: s = s.replace(old, new, 1)

p.write_text(s)

# ---------------- src/api.js ----------------
p = Path('src/api.js')
s = p.read_text()
append = """
export function reviewAdminDocument(applicationId, documentId, decision) {
  return request(`/api/uez/admin/applications/${applicationId}/documents/${documentId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision })
  });
}
"""
if 'reviewAdminDocument' not in s:
    s += append
p.write_text(s)

# ---------------- src/AdminPage.jsx ----------------
p = Path('src/AdminPage.jsx')
s = p.read_text()
s = s.replace("  saveAdminPayment,\n  whoAmI", "  saveAdminPayment,\n  reviewAdminDocument,\n  whoAmI")

# Approval review must count toward readiness and grant unlock.
s = s.replace("    && Boolean(docFor(detail, 'uez_approval_email'))\n", "    && Boolean(docFor(detail, 'uez_approval_email'))\n    && detail?.application?.uez_approval_review_status === 'approved'\n", 1)
s = s.replace("    + (docFor(detail, 'uez_approval_email') ? 1 : 0)\n", "    + (docFor(detail, 'uez_approval_email') && detail?.application?.uez_approval_review_status === 'approved' ? 1 : 0)\n", 1)

old = """  async function reviewPreviewDoc(result) {
    if (!previewDoc) return;
    const type = previewDoc.document_type;
    if (type === 'formation') await setProcessFlag('formationReviewStatus', result);
    if (type === 'uez_approval_email') await setProcessFlag('uezApprovalReviewStatus', result);
    closePreview();
  }
"""
new = """  async function reviewPreviewDoc(result) {
    if (!previewDoc) return;
    setBusy(true);
    setMessage(result === 'approved' ? 'Approving document…' : 'Marking document as wrong…');
    try {
      await reviewAdminDocument(detail.application.id, previewDoc.id, result);
      await refreshList(detail.application.id);
      setMessage(result === 'approved' ? 'Document approved.' : 'Document marked as wrong.');
      closePreview();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }
"""
if old not in s: raise SystemExit('reviewPreviewDoc anchor missing')
s = s.replace(old, new, 1)

p.write_text(s)

# ---------------- brc-helper-extension/content.js ----------------
p = Path('brc-helper-extension/content.js')
s = p.read_text()

old_start = """  const cleanCertificateHtml = () => {
"""
if old_start not in s: raise SystemExit('cleanCertificateHtml start missing')
start = s.index(old_start)
end_marker = """  const notice = (message) => {
"""
end = s.index(end_marker, start)
old_block = s[start:end]
new_block = r'''  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not encode image.'));
    reader.readAsDataURL(blob);
  });

  const renderedImageDataUrl = async (image) => {
    if (!image) return '';
    try {
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl !== 'data:,') return dataUrl;
      }
    } catch (_) {}

    try {
      const src = image.currentSrc || image.src || image.getAttribute('src');
      if (!src) return '';
      const response = await fetch(src, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) return '';
      return await blobToDataUrl(await response.blob());
    } catch (_) {
      return '';
    }
  };

  const cleanCertificateHtml = async () => {
    // Hide our own UI before measuring/cloning so it can never leak into the certificate.
    const helperNotice = document.getElementById('cor-uez-helper-notice');
    const previousNoticeDisplay = helperNotice?.style?.display;
    if (helperNotice) helperNotice.style.display = 'none';

    try {
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

      const source = candidates[0]?.element || document.body;
      const clone = source.cloneNode(true);
      clone.querySelectorAll('#cor-uez-helper-notice, script, button, input[type="button"], input[type="submit"], input[value="Return"], a').forEach((element) => element.remove());

      // Critical: the NJ seal/logo is an image resource. The backend Playwright renderer
      // does not share this browser's NJ session, so remote image references can become
      // empty boxes. Embed the actual rendered pixels into the HTML as data URLs.
      const sourceImages = [...source.querySelectorAll('img')];
      const clonedImages = [...clone.querySelectorAll('img')];
      await Promise.all(clonedImages.map(async (clonedImage, index) => {
        const originalImage = sourceImages[index];
        const dataUrl = await renderedImageDataUrl(originalImage);
        if (!dataUrl) return;
        clonedImage.removeAttribute('srcset');
        clonedImage.setAttribute('src', dataUrl);
      }));

      const headAssets = [...document.querySelectorAll('head style, head link[rel="stylesheet"]')]
        .map((element) => element.outerHTML)
        .join('\n');
      const baseHref = escapeHtmlAttribute(location.href);

      return `<!doctype html><html><head><meta charset="utf-8"><base href="${baseHref}">${headAssets}<style>
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        body { width: auto !important; min-width: 0 !important; }
        #cor-uez-helper-notice, button, input[type="button"], input[type="submit"], input[value="Return"], a { display: none !important; }
        @page { margin: 0.3in; }
      </style></head><body>${clone.outerHTML}</body></html>`;
    } finally {
      if (helperNotice) helperNotice.style.display = previousNoticeDisplay || '';
    }
  };

'''
s = s[:start] + new_block + s[end:]

s = s.replace("        const certificateHtml = cleanCertificateHtml();", "        const certificateHtml = await cleanCertificateHtml();")

p.write_text(s)

# ---------------- backend/routes/uezBrc.js ----------------
p = Path('backend/routes/uezBrc.js')
s = p.read_text()
old = """    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });
"""
new = """    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => Array.from(document.images || []).every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' } });
"""
if old not in s: raise SystemExit('BRC renderer anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)

# ---------------- extension manifest ----------------
p = Path('brc-helper-extension/manifest.json')
s = p.read_text()
s = s.replace('"version": "1.3.1"', '"version": "1.3.2"')
if 'https://mnmarnctabptqiwpcgrs.supabase.co/*' not in s:
    s = s.replace('    "https://uez.corsolutions.io/*",\n', '    "https://uez.corsolutions.io/*",\n    "https://mnmarnctabptqiwpcgrs.supabase.co/*",\n')
p.write_text(s)
