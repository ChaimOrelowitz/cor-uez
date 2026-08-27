from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

admin_path = Path('src/AdminPage.jsx')
admin = admin_path.read_text()

admin = replace_once(
    admin,
    "  if (submittedGrant) return { bucket: 'waiting', action: 'Grant submitted', tone: 'quiet', stage, rank: 90 };",
    "  if (submittedGrant) return { bucket: 'submitted', action: 'Grant submitted', tone: 'submitted', stage, rank: 0 };",
    'submitted bucket'
)

admin = replace_once(
    admin,
    "        const bucketPriority = { needs: 0, ready: 1, waiting: 2 };",
    "        const bucketPriority = { needs: 0, ready: 1, waiting: 2, submitted: 3 };",
    'bucket sort priority'
)

admin = replace_once(
    admin,
    "    ready: applications.filter((app) => adminQueueInfo(app).bucket === 'ready').length,\n    all: applications.length",
    "    ready: applications.filter((app) => adminQueueInfo(app).bucket === 'ready').length,\n    submitted: applications.filter((app) => adminQueueInfo(app).bucket === 'submitted').length,\n    all: applications.length",
    'submitted count'
)

admin = replace_once(
    admin,
    "            ['ready', 'Ready', counts.ready],\n            ['all', 'All', counts.all]",
    "            ['ready', 'Ready', counts.ready],\n            ['submitted', 'Submitted', counts.submitted],\n            ['all', 'All', counts.all]",
    'submitted filter'
)

admin_path.write_text(admin)

css_path = Path('src/workflow.css')
css = css_path.read_text()
css = replace_once(
    css,
    ".admin-filter-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 5px; padding: 0 12px 12px; border-bottom: 1px solid #edf0f5; }",
    ".admin-filter-row { display: grid; grid-template-columns: repeat(5,1fr); gap: 5px; padding: 0 12px 12px; border-bottom: 1px solid #edf0f5; }",
    'desktop filter columns'
)

# Style submitted as complete/quiet rather than actionable.
marker = '.queue-next-action.submitted'
if marker not in css:
    css += "\n.queue-next-action.submitted { color: #357a52; }\n.queue-next-action.submitted i { background: #56a66f; }\n.queue-submitted { background: #fbfdfb; }\n"

css_path.write_text(css)
