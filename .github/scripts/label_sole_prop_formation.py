from pathlib import Path
p = Path('src/AdminPage.jsx')
s = p.read_text()
old = "sole && !formation ? 'Not required' : !formation ? 'Missing'"
new = "sole && !formation ? 'Not required (sole prop)' : !formation ? 'Missing'"
if old not in s:
    raise SystemExit('formation label target not found')
p.write_text(s.replace(old, new, 1))
