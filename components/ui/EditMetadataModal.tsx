"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

type Props = {
  title: string;
  description: string;
  kind: "пачки" | "урока";
  onClose: () => void;
  onSave: (title: string, description: string) => Promise<void>;
};

export function EditMetadataModal({ title: initialTitle, description: initialDescription, kind, onClose, onSave }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setError("Название не может быть пустым."); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(title.trim(), description.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить изменения.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-meta-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <form className="edit-meta-modal" onSubmit={(event) => void submit(event)}>
        <div className="edit-meta-header">
          <h2>Изменить название и описание {kind}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <label>Название
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus />
        </label>
        <label>Описание
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={4} />
        </label>
        {error && <p className="inline-error">{error}</p>}
        <button type="submit" className="seed-btn" disabled={saving}><Check size={15} />{saving ? "Сохраняю…" : "Сохранить"}</button>
      </form>
    </div>
  );
}

const STYLES = `
  .edit-meta-backdrop { position: fixed; inset: 0; z-index: 150; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,0.62); }
  .edit-meta-modal { width: min(100%, 520px); display: grid; gap: 14px; padding: 20px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg-secondary); color: var(--text-primary); box-shadow: 0 18px 60px rgba(0,0,0,0.45); }
  .edit-meta-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .edit-meta-header h2 { margin: 0; font-size: 18px; }
  .edit-meta-modal label { display: grid; gap: 6px; color: var(--text-muted); font-size: 12px; font-weight: 600; }
  .edit-meta-modal input, .edit-meta-modal textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 9px; padding: 10px 11px; background: rgba(240,230,211,0.04); color: var(--text-primary); font: inherit; font-size: 14px; }
  .edit-meta-modal textarea { resize: vertical; }
`;
