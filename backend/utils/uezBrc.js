const BRC_LOOKUP_URL = 'https://www1.state.nj.us/TYTR_BRC/servlet/common/BRCLogin';
const BRC_REFERER = 'https://www1.state.nj.us/TYTR_BRC/jsp/BRCLoginJsp.jsp';

function normalizeEin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 9);
}

function buildNjTaxId(ein) {
  const normalized = normalizeEin(ein);
  if (normalized.length !== 9) throw new Error('A valid 9-digit EIN is required for the BRC lookup.');
  return `${normalized}000`;
}

function buildNameControl(businessName) {
  const normalized = String(businessName || '').trim().toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  if (!normalized) throw new Error('Business name is required for the BRC lookup.');
  return normalized.slice(0, 4).padEnd(4, '-');
}

function brcLookupDescriptor(application) {
  if (!application) throw new Error('Application is required');
  const businessName = application.registered_business_name || application.business_name_input || null;
  return { businessName, nameControl: buildNameControl(businessName), ein: normalizeEin(application.ein), njTaxId: buildNjTaxId(application.ein) };
}

function decodeEntities(value) {
  return String(value || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToText(html) {
  return decodeEntities(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function between(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  if (start < 0) return null;
  const from = start + startLabel.length;
  const end = endLabel ? text.indexOf(endLabel, from) : text.length;
  return text.slice(from, end < 0 ? text.length : end).trim() || null;
}

function parseBrcCertificateHtml(html) {
  const raw = String(html || '');
  if (/Request unsuccessful\. Incapsula incident ID/i.test(raw) || /_Incapsula_Resource/i.test(raw) || /hcaptcha/i.test(raw)) return { status: 'challenge_required' };
  const text = htmlToText(raw);
  if (/There was no match on the fields entered\./i.test(text)) return { status: 'not_found' };
  if (!/BUSINESS REGISTRATION CERTIFICATE/i.test(text) || !/Certificate Number:/i.test(text)) return { status: 'unrecognized_response', text: text.slice(0, 1000) };
  return {
    status: 'found',
    taxpayerName: between(text, 'Taxpayer Name:', 'Trade Name:'),
    tradeName: between(text, 'Trade Name:', 'Address:'),
    address: between(text, 'Address:', 'Certificate Number:'),
    certificateNumber: between(text, 'Certificate Number:', 'Effective Date:'),
    effectiveDate: between(text, 'Effective Date:', 'Date of Issuance:'),
    issuanceDate: between(text, 'Date of Issuance:', 'For Office Use Only:')
  };
}

async function lookupBrc(application) {
  const lookup = brcLookupDescriptor(application);
  const body = new URLSearchParams({ pinnctl: lookup.nameControl.toLowerCase(), pinidnum: lookup.njTaxId, pincorpid: '', pincasinoid: '', submit: '  Submit  ' });
  const response = await fetch(BRC_LOOKUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html,application/xhtml+xml', 'Referer': BRC_REFERER, 'User-Agent': 'COR-Solutions-UEZ/1.0' },
    body: body.toString(),
    redirect: 'follow'
  });
  const html = await response.text();
  return { httpStatus: response.status, lookup, ...parseBrcCertificateHtml(html), html };
}

module.exports = { BRC_LOOKUP_URL, normalizeEin, buildNjTaxId, buildNameControl, brcLookupDescriptor, parseBrcCertificateHtml, lookupBrc };
