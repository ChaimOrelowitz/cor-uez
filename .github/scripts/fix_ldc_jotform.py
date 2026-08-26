from pathlib import Path
import json


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label} anchor not found in {path}')
    p.write_text(s.replace(old, new, 1))


p = Path('brc-helper-extension/jotform.js')
s = p.read_text()

old = '''  function parseBusinessAddress(application) {
    let line1 = String(application.address_line1 || '').trim();
    let line2 = String(application.address_line2 || '').trim();
    let city = String(application.city || '').trim();
    let state = String(application.state || '').trim() || 'NJ';
    let postal = String(application.zip || '').trim();

    if ((!city || !postal) && line1) {
      const candidates = [line1, application.brc_data?.address].filter(Boolean).map((value) => String(value).trim());
      for (const candidate of candidates) {
        const match = candidate.match(/^(.*?),\\s*([^,]+),\\s*([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)$/i);
        if (!match) continue;
        line1 = match[1].trim();
        city = city || match[2].trim();
        state = state || match[3].trim().toUpperCase();
        postal = postal || match[4].trim();
        break;
      }
    }

    return { line1, line2, city, state: state || 'NJ', postal };
  }'''

new = '''  function normalizeState(value) {
    const text = String(value || '').trim();
    const normalized = text.toLowerCase().replace(/\\./g, '');
    if (normalized === 'new jersey' || normalized === 'nj') return 'NJ';
    return text.length === 2 ? text.toUpperCase() : text;
  }

  function parseBusinessAddress(application) {
    let line1 = String(application.address_line1 || '').trim();
    let line2 = String(application.address_line2 || '').trim();
    let city = String(application.city || '').trim();
    let state = normalizeState(application.state || '') || 'NJ';
    let postal = String(application.zip || '').trim();

    const parts = line1.split(',').map((part) => part.trim()).filter(Boolean);
    if ((!city || !postal) && parts.length >= 4 && /^\\d{5}(?:-\\d{4})?$/.test(parts[parts.length - 1])) {
      postal = postal || parts[parts.length - 1];
      state = normalizeState(parts[parts.length - 2]) || state || 'NJ';
      city = city || parts[parts.length - 3];
      line1 = parts.slice(0, -3).join(', ');
    } else if ((!city || !postal) && parts.length >= 3) {
      const last = parts[parts.length - 1].match(/^(.+?)\\s+(\\d{5}(?:-\\d{4})?)$/);
      if (last) {
        postal = postal || last[2];
        state = normalizeState(last[1]) || state || 'NJ';
        city = city || parts[parts.length - 2];
        line1 = parts.slice(0, -2).join(', ');
      }
    }

    return { line1, line2, city, state: normalizeState(state) || 'NJ', postal };
  }'''

if old not in s:
    raise SystemExit('business address parser anchor not found')
s = s.replace(old, new, 1)

old = '''  function visibleNextButton() {
    const page = visiblePage();
    const candidates = page
      ? [...page.querySelectorAll('.form-pagebreak-next, button.form-pagebreak-next, input.form-pagebreak-next')]
      : [...document.querySelectorAll('.form-pagebreak-next, button.form-pagebreak-next, input.form-pagebreak-next')];
    return candidates.find((button) => button.offsetParent !== null && !button.disabled) || null;
  }
'''
new = old + '''
  function visibleControlByText(labels) {
    const wanted = labels.map((label) => label.toLowerCase());
    const candidates = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')];
    return candidates.find((element) => {
      if (element.disabled || element.offsetParent === null) return false;
      const text = String(element.value || element.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      return wanted.some((label) => text === label || text.includes(label));
    }) || null;
  }

  async function clickStartFillingIfPresent(job) {
    const button = visibleControlByText(['Start Filling']);
    if (!button) return false;
    const key = `corLdcStartFilling:${job.id}:${location.href}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      notice('COR filled the application data. Opening the JotForm Sign fields…');
      await notifyStatus('starting_ldc_sign');
      setTimeout(() => button.click(), 150);
    }
    return true;
  }
'''
if old not in s:
    raise SystemExit('visibleNextButton anchor not found')
s = s.replace(old, new, 1)

old = '''    const host = location.hostname.toLowerCase();
    if (host === 'submit.jotform.com') {
      await captureCompletedPdf(job);
      return;
    }

    if (host !== 'form.jotform.com') return;
    if (!applicationData) applicationData = await getApplicationData(job);
'''
new = '''    const host = location.hostname.toLowerCase();

    if (await clickStartFillingIfPresent(job)) return;

    if (host === 'submit.jotform.com') {
      await captureCompletedPdf(job);
      return;
    }

    if (host !== 'form.jotform.com') return;
    if (!applicationData) applicationData = await getApplicationData(job);
'''
if old not in s:
    raise SystemExit('runOnce host anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

# Manifest: 1.2.1, broad JotForm host access, helper in all frames.
mp = Path('brc-helper-extension/manifest.json')
m = json.loads(mp.read_text())
m['version'] = '1.2.1'
if 'https://*.jotform.com/*' not in m['host_permissions']:
    m['host_permissions'].append('https://*.jotform.com/*')
for cs in m['content_scripts']:
    if 'jotform.js' in cs.get('js', []):
        cs['matches'] = ['https://*.jotform.com/*']
        cs['all_frames'] = True
        cs['match_about_blank'] = True
        cs['match_origin_as_fallback'] = True
mp.write_text(json.dumps(m, indent=2) + '\n')

# Admin status message.
ap = Path('src/AdminPage.jsx')
a = ap.read_text()
needle = "      waiting_for_signature: 'Application filled. Add the required signature in the JotForm popup.',"
if needle in a and 'starting_ldc_sign:' not in a:
    a = a.replace(needle, "      starting_ldc_sign: 'Opening JotForm Sign so the required signature can be added…',\n" + needle, 1)
ap.write_text(a)

# Remove temporary patch files from the final application commit.
for path in [
    '.github/workflows/fix-ldc-jotform-flow.yml',
    '.github/workflows/fix-ldc-jotform-flow-2.yml',
    '.github/scripts/fix_ldc_jotform.py'
]:
    Path(path).unlink(missing_ok=True)
