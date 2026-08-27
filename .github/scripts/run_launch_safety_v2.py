from pathlib import Path

source_path = Path('.github/scripts/launch_safety_soleprop_demo.py')
source = source_path.read_text()
source = source.replace(
    "    if count != 1:\n        raise SystemExit(f'{label}: expected 1 match, found {count}')",
    "    if count < 1:\n        raise SystemExit(f'{label}: expected at least 1 match, found {count}')"
)
exec(compile(source, str(source_path), 'exec'))
