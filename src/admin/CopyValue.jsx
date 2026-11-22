import React, { useState } from 'react';

// A value that copies itself on click. The icon floats in the column gap so it
// never changes layout; a green flash confirms the copy.
export default function CopyValue({ value, label, children, className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="cw-cv-empty">—</span>;
  return (
    <button
      type="button"
      className={`cw-cv${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(String(value));
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard denied - no-op */ }
      }}
    >
      <span className="cw-cv-text">{children ?? value}</span>
      <svg className="cw-cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={copied ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied
          ? <path d="M20 6 9 17l-5-5" />
          : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
      </svg>
    </button>
  );
}
