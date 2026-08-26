from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing {label} in {path}')
    p.write_text(s.replace(old, new, 1))

# Keep helper feedback visible but never over/capturing the NJ CAPTCHA.
rep('brc-helper-extension/content.js',
"""        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        background: '#17203a', color: 'white', padding: '12px 16px',
        borderRadius: '10px', font: '13px system-ui, -apple-system, sans-serif',
        maxWidth: '380px', boxShadow: '0 8px 25px rgba(0,0,0,.3)', border: '1px solid #3b4261'""",
"""        position: 'fixed', bottom: '10px', left: '10px', zIndex: '2147483647',
        background: '#17203a', color: 'white', padding: '8px 10px',
        borderRadius: '8px', font: '12px system-ui, -apple-system, sans-serif',
        maxWidth: '300px', boxShadow: '0 5px 16px rgba(0,0,0,.22)', border: '1px solid #3b4261',
        pointerEvents: 'none', opacity: '.88'""",
'helper notice position')

# Formation only auto-satisfies a sole prop when there is no uploaded Formation to review.
rep('src/AdminPage.jsx',
"""function formationSatisfied(detail) {
  return Boolean(detail?.application?.is_sole_proprietorship) || Boolean(docFor(detail, 'formation') && detail?.application?.formation_review_status === 'approved');
}""",
"""function formationSatisfied(detail) {
  const formation = docFor(detail, 'formation');
  if (!formation) return Boolean(detail?.application?.is_sole_proprietorship);
  return detail?.application?.formation_review_status === 'approved';
}""",
'formationSatisfied')

rep('src/AdminPage.jsx',
"""  if (!detail.application.is_sole_proprietorship && formation && detail.application.formation_review_status === 'not_reviewed') items.push('Review Certificate of Formation');
  if (!detail.application.is_sole_proprietorship && detail.application.formation_review_status === 'rejected') items.push('Certificate of Formation marked wrong');""",
"""  if (formation && detail.application.formation_review_status === 'not_reviewed') items.push('Review Certificate of Formation');
  if (formation && detail.application.formation_review_status === 'rejected') items.push('Certificate of Formation marked wrong');""",
'formation attention')

rep('src/AdminPage.jsx',
"""              || (!app.is_sole_proprietorship && (app.document_types || []).includes('formation') && app.formation_review_status !== 'approved')""",
"""              || ((app.document_types || []).includes('formation') && app.formation_review_status !== 'approved')""",
'list formation attention')

rep('src/AdminPage.jsx',
"""<small>{sole ? 'Not required' : !formation ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small>""",
"""<small>{sole && !formation ? 'Not required' : !formation ? 'Missing' : review === 'approved' ? 'Approved' : review === 'rejected' ? 'Wrong document' : 'Review'}</small>""",
'formation row label')

# Any actual formation upload is reviewable, regardless of the applicant's sole-prop answer.
rep('backend/routes/uez.js',
"""    if (documentType === 'formation' && !application.is_sole_proprietorship) {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }""",
"""    if (documentType === 'formation') {
      await supabase.from('uez_applications').update({ formation_review_status: 'not_reviewed', updated_at: new Date().toISOString() }).eq('id', application.id);
    }""",
'formation upload review reset')

rep('backend/routes/uez.js',
"""    if (document.document_type === 'formation') {
      if (application.is_sole_proprietorship) return res.status(400).json({ error: 'Formation review is not required for a sole proprietorship.' });
      patch.formation_review_status = decision;""",
"""    if (document.document_type === 'formation') {
      patch.formation_review_status = decision;""",
'formation review sole prop block')

# Extension version bump so it is obvious the local helper is updated.
rep('brc-helper-extension/manifest.json', '"version": "1.3.5"', '"version": "1.3.6"', 'extension version')
