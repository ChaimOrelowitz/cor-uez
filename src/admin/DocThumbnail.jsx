import React, { useEffect, useState } from 'react';
import { getDocumentUrl } from '../api';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

function isImageDoc(doc) {
  if (doc?.metadata?.mimeType) return doc.metadata.mimeType.startsWith('image/');
  return IMAGE_EXT_RE.test(doc?.filename || '');
}

// A small, always-clickable square preview of an uploaded document - the
// same signed URL previewDocument() fetches for the full-screen modal, just
// shown inline at thumbnail size. Images render as an <img>; everything else
// (PDF, .eml) falls back to a generic document glyph rather than trying to
// shrink an iframe into a tiny box, which nothing in this app supports.
// doc may be null/undefined - every process-step card with a document
// renders this holder even before anything's on file, so the layout doesn't
// jump once a doc actually shows up.
export default function DocThumbnail({ doc, applicationId, onClick }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(Boolean(doc));

  useEffect(() => {
    if (!doc) { setUrl(''); setLoading(false); return; }
    let cancelled = false;
    setUrl('');
    setLoading(true);
    getDocumentUrl(applicationId, doc.id)
      .then((result) => { if (!cancelled) setUrl(result.url); })
      .catch(() => { /* decorative - the icon fallback still opens the real modal */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [doc?.id, applicationId]);

  if (!doc) {
    return <span className="doc-thumb doc-thumb-empty" aria-hidden="true" />;
  }

  const image = isImageDoc(doc);

  return (
    <button type="button" className="doc-thumb" onClick={onClick} title={doc.filename}>
      {loading
        ? <span className="doc-thumb-loading" />
        : (image && url)
          ? <img src={url} alt={doc.filename} className="doc-thumb-img" />
          : <span className="doc-thumb-icon" aria-hidden="true">📄</span>}
    </button>
  );
}
