"use client";

/**
 * One toast stack for the whole dashboard.
 *
 * Pages used to each keep their own `toast` state (leads, whatsapp,
 * campaigns) or fall back to window.alert() (desk, setup, billing). alert()
 * blocks the tab, looks like a browser error, and on a phone hides the
 * thing it is talking about. This is a plain event bus: call toast() from
 * anywhere; <Toaster/> (mounted once in Shell) draws the stack.
 */
import { useEffect, useState } from "react";

type Kind = "ok" | "err" | "info";
type Item = { id: number; kind: Kind; text: string };

const EVT = "nikki:toast";
let seq = 0;

export function toast(text: string, kind: Kind = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT, { detail: { id: ++seq, kind, text } }));
}
toast.ok  = (t: string) => toast(t, "ok");
toast.err = (t: string) => toast(t, "err");

export default function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const it = (e as CustomEvent<Item>).detail;
      setItems(xs => [...xs.slice(-3), it]);
      // Errors linger; confirmations do not need to.
      setTimeout(() => setItems(xs => xs.filter(x => x.id !== it.id)), it.kind === "err" ? 7000 : 3500);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  if (!items.length) return null;
  return (
    <div className="nk-toasts" role="status" aria-live="polite">
      {items.map(it => (
        <div key={it.id} className={`nk-toast ${it.kind}`}>
          <span>{it.text}</span>
          <button aria-label="Dismiss" onClick={() => setItems(xs => xs.filter(x => x.id !== it.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
