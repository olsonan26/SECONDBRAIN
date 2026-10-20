"use client";
import { useRef, useState, type FormEvent } from "react";
import { BrainCircuit, Plus, X, LoaderCircle, ChevronDown } from "lucide-react";
import type { Brain } from "@/lib/types";

interface Props {
  brain: Brain;
  brains: Brain[];
  canCreate: boolean;
  disabled: boolean;
  beforeChange: () => boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

export default function BrainSwitcher({ brain, brains, canCreate, disabled, beforeChange, onSwitch, onCreate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try { await onCreate(name.trim(), description.trim()); }
    catch (error) { setError(error instanceof Error ? error.message : "The brain could not be created. Please try again."); setBusy(false); }
  }
  return <>
    <div className="brain-switcher">
      <span className={`brain-switcher-icon ${brain.id === "main" ? "main" : "separate"}`}><BrainCircuit size={21} /></span>
      <div className="brain-switcher-field"><label htmlFor="active-brain">Active brain</label><div className="brain-select-wrap"><select id="active-brain" value={brain.id} disabled={disabled} onChange={event => {
        if (beforeChange()) onSwitch(event.target.value); else event.currentTarget.value = brain.id;
      }}>{brains.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={12} /></div></div>
      {canCreate && <button type="button" className="brain-create-button" aria-label="Create a brain" title="Create a separate brain" disabled={disabled} onClick={() => { if (beforeChange()) { setError(""); dialog.current?.showModal(); } }}><Plus size={17} /></button>}
    </div>
    <dialog ref={dialog} className="brain-create-dialog" aria-labelledby="brain-dialog-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={submit}>
        <div className="brain-dialog-heading"><span className="brain-dialog-icon"><BrainCircuit size={29} /></span><button type="button" className="icon-button" aria-label="Close create brain" disabled={busy} onClick={() => dialog.current?.close()}><X size={19} /></button></div>
        <h2 id="brain-dialog-title">A new space to think.</h2><p>Give this subject its own brain. Sources, connections, questions, articles, and workflow history stay separate from your other brains.</p>
        <label className="field-label" htmlFor="brain-name">Brain name</label><input id="brain-name" value={name} onChange={e => setName(e.target.value)} placeholder="Astrology" maxLength={60} required autoFocus disabled={busy} />
        <label className="field-label" htmlFor="brain-description">What belongs here? <span>(optional)</span></label><textarea id="brain-description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Planets, zodiac signs, chart interpretations…" maxLength={240} rows={3} disabled={busy} />
        <p className="brain-create-note">Starts empty. Shared with Peter. Uses your existing model connection and writing rules.</p>
        {error && <p className="brain-create-error" role="alert">{error}</p>}
        <div className="brain-dialog-actions"><button type="button" className="button button-secondary" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !name.trim()}>{busy ? <><LoaderCircle size={16} className="spin" />Creating…</> : <><Plus size={16} />Create brain</>}</button></div>
      </form>
    </dialog>
  </>;
}
