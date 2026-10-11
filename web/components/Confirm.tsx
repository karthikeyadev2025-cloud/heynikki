"use client";

/**
 * One confirm / ask dialog for the whole dashboard.
 *
 * Deleting a recording, revoking a key and releasing a number each used
 * window.confirm(), and the Desk review used window.prompt(). Those look
 * like a browser warning rather than part of the product, cannot say which
 * button is the dangerous one, and on a phone cover the thing being
 * confirmed. Same idea as Toast: call confirmDialog() / askDialog() from
 * anywhere and await the answer; <ConfirmHost/> (mounted once in Shell)
 * draws it.
 */
import { useEffect, useRef, useState } from "react";

type Req = {
  id: number; title: string; body?: string;
  confirmLabel?: string; cancelLabel?: string; danger?: boolean;
  ask?: { placeholder?: string; initial?: string };
  resolve: (v: any) => void;
};

const EVT = "nikki:confirm";
let seq = 0;

function open(req: Omit<Req, "id" | "resolve">): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(req.ask ? null : false);
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { ...req, id: ++seq, resolve } }));
  });
}

/** Resolves true when the person confirms, false when they cancel or press Escape. */
export function confirmDialog(o: { title: string; body?: string; confirmLabel?: string;
                                   cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return open(o);
}

/** Resolves the typed text ("" allowed), or null when cancelled. */
export function askDialog(o: { title: string; body?: string; placeholder?: string;
                               initial?: string; confirmLabel?: string }): Promise<string | null> {
  return open({ ...o, ask: { placeholder: o.placeholder, initial: o.initial } });
}

export default function ConfirmHost() {
  const [req, setReq]   = useState<Req | null>(null);
  const [text, setText] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<Req>).detail;
      setText(r.ask?.initial || "");
      setReq(r);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const close = (v: any) => { if (req) req.resolve(v); setReq(null); };

  useEffect(() => {
    if (!req) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(req.ask ? null : false); };
    window.addEventListener("keydown", key);
    if (!req.ask) okRef.current?.focus();
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;
  const cancel = () => close(req.ask ? null : false);
  const ok     = () => close(req.ask ? text : true);
  return (
    <div className="nk-confirm-scrim" onClick={cancel}>
      <div className="nk-confirm" role="alertdialog" aria-modal="true" aria-labelledby="nk-confirm-title"
           onClick={e => e.stopPropagation()}>
        <div id="nk-confirm-title" className="nk-confirm-title">{req.title}</div>
        {req.body && <div className="nk-confirm-body">{req.body}</div>}
        {req.ask && (
          <textarea autoFocus rows={3} value={text} placeholder={req.ask.placeholder}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ok(); }} />
        )}
        <div className="nk-confirm-actions">
          <button type="button" className="ghost" onClick={cancel}>{req.cancelLabel || "Cancel"}</button>
          <button type="button" ref={okRef} className={req.danger ? "danger" : "primary"} onClick={ok}>
            {req.confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
