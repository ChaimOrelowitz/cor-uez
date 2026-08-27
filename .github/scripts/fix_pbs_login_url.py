from pathlib import Path
import json

ROOT = Path('.')
TARGET = 'https://my.nj.gov/aui/Login?goto=https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/OEGController?actionToPerform=login'
OLD = 'https://www-njlib.nj.gov/NJ_PREMIER_EBIZ/jsp/home.jsp'
OLD_STATE = 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'

# Client application: the "Not sure? Open PBS / MyNJ" link.
app_path = ROOT / 'src/App.jsx'
app = app_path.read_text()
if OLD not in app:
    raise SystemExit('Expected old PBS client URL not found in src/App.jsx')
app = app.replace(OLD, TARGET)
app_path.write_text(app)

# Admin: canonical Open PBS URL constant.
admin_path = ROOT / 'src/AdminPage.jsx'
admin = admin_path.read_text()
if OLD not in admin:
    raise SystemExit('Expected old PBS admin URL not found in src/AdminPage.jsx')
admin = admin.replace(OLD, TARGET)
admin_path.write_text(admin)

# Extension: PBS login and tax-clearance login should land at MyNJ with PBS as the goto target.
bg_path = ROOT / 'brc-helper-extension/background.js'
bg = bg_path.read_text()
needle = "job.workflow === 'tax_clearance' || job.workflow === 'pbs_login'\n      ? 'https://www16.state.nj.us/NJ_PREMIER_EBIZ/jsp/home.jsp'"
replacement = "job.workflow === 'tax_clearance' || job.workflow === 'pbs_login'\n      ? '" + TARGET + "'"
if needle not in bg:
    raise SystemExit('Expected PBS extension start URL not found in background.js')
bg = bg.replace(needle, replacement)
bg_path.write_text(bg)

manifest_path = ROOT / 'brc-helper-extension/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['version'] = '1.3.14'
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
