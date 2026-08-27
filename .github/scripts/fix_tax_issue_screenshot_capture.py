from pathlib import Path

content_path = Path('brc-helper-extension/content.js')
content = content_path.read_text()

old = """      // Bad tax-clearance result: NJ returns to this same screen with an eligibility error.\n      if (/We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(text)) {\n        sent = true;\n        const issue = [...document.querySelectorAll('td, div, table, section, form')].find((element) =>\n          /We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(element.innerText || '')\n        );\n        issue?.scrollIntoView({ block: 'start', inline: 'nearest' });\n        await new Promise((resolve) => setTimeout(resolve, 180));\n        notice('NJ could not issue the tax clearance. COR is saving this screen and notifying the client.');\n        await send({ type: 'COR_TAX_ISSUE_CAPTURE_REQUEST', jobId: job.id });\n        return;\n      }\n"""

new = """      // Bad tax-clearance result: NJ returns to this same screen with an eligibility error.\n      if (/We cannot verify that you are eligible to receive a Tax Clearance Certificate at this time/i.test(text)) {\n        sent = true;\n\n        // The screenshot is a client record, so it must contain the actual NJ page only.\n        // Hide COR's helper notice and capture from the absolute top so the NJ header and\n        // Representative line are included along with the red eligibility message.\n        const helperNotice = document.getElementById('cor-uez-helper-notice');\n        if (helperNotice) helperNotice.style.display = 'none';\n        window.scrollTo(0, 0);\n        if (document.documentElement) document.documentElement.scrollTop = 0;\n        if (document.body) document.body.scrollTop = 0;\n        await new Promise((resolve) => setTimeout(resolve, 350));\n\n        await send({ type: 'COR_TAX_ISSUE_CAPTURE_REQUEST', jobId: job.id });\n        return;\n      }\n"""

if content.count(old) != 1:
    raise SystemExit(f'Expected exactly one bad-tax screenshot block, found {content.count(old)}')
content = content.replace(old, new, 1)
content_path.write_text(content)

manifest_path = Path('brc-helper-extension/manifest.json')
manifest = manifest_path.read_text()
old_version = '"version": "1.3.10"'
new_version = '"version": "1.3.11"'
if manifest.count(old_version) != 1:
    raise SystemExit(f'Expected extension version 1.3.10 exactly once, found {manifest.count(old_version)}')
manifest_path.write_text(manifest.replace(old_version, new_version, 1))
