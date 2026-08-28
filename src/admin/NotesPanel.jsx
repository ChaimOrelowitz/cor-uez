import React from 'react';
import { formatTimestamp } from './caseLogic';

// Fast, journal-style notes: textarea + Add Note, no modal. State (draft,
// editing) lives in the parent since notes are saved through the API against
// the selected application - this is the presentational half.
export default function NotesPanel({
  notes,
  draft,
  busy,
  editingId,
  editDraft,
  onDraftChange,
  onAdd,
  onStartEdit,
  onCancelEdit,
  onEditDraftChange,
  onSaveEdit,
  onDelete
}) {
  const list = notes || [];
  return (
    <section className="admin-card admin-notes-card">
      <div className="admin-card-head"><h3>Notes</h3></div>
      <div className="case-note-composer">
        <textarea value={draft} onChange={(e) => onDraftChange(e.target.value)} placeholder="Add a note…" rows={2} disabled={busy} />
        <button className="primary" onClick={onAdd} disabled={busy || !draft.trim()}>{busy ? 'Saving…' : 'Add Note'}</button>
      </div>
      <div className="case-note-list">
        {list.map((note) => (
          <div key={note.id} className="case-note-item">
            {editingId === note.id ? <>
              <textarea value={editDraft} onChange={(e) => onEditDraftChange(e.target.value)} rows={2} disabled={busy} />
              <div className="case-note-edit-actions">
                <button className="primary" onClick={() => onSaveEdit(note.id)} disabled={busy || !editDraft.trim()}>Save</button>
                <button className="secondary" onClick={onCancelEdit} disabled={busy}>Cancel</button>
              </div>
            </> : <>
              <div className="case-note-head">
                <strong>{formatTimestamp(note.created_at)} — {note.author_name || 'COR'}</strong>
                <div className="case-note-actions">
                  <button type="button" onClick={() => onStartEdit(note)} disabled={busy}>Edit</button>
                  <button type="button" onClick={() => onDelete(note.id)} disabled={busy}>Delete</button>
                </div>
              </div>
              <p>{note.body}</p>
              {note.updated_at && <small className="muted">Edited {formatTimestamp(note.updated_at)}</small>}
            </>}
          </div>
        ))}
        {list.length === 0 && <p className="muted">No notes yet.</p>}
      </div>
    </section>
  );
}
