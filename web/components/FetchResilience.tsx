"use client";

import { useEffect } from "react";

/**
 * Retry a request once when the network itself fails.
 *
 * Deploying the API restarts a single container, and for the ten or twenty
 * seconds that takes, the tunnel answers with an error page carrying no CORS
 * headers. The browser reports that as "blocked by CORS policy: No
 * 'Access-Control-Allow-Origin' header", which reads like a catastrophic
 * misconfiguration and is really just a restart — every page open at that
 * moment showed a wall of red and stayed empty until someone reloaded.
 *
 * One retry after a short pause covers the window. Deliberately narrow:
 *
 *   - only a genuine network failure (fetch rejects), never an HTTP error —
 *     a 401 or a 500 is an answer and must be handled by the caller;
 *   - only GET and HEAD, so nothing that changes state is ever sent twice;
 *   - exactly one retry, so a truly unreachable API still fails fast rather
 *     than hanging a page in a loop.
 */
export default function FetchResilience() {
  useEffect(() => {
    const w = window as any;
    if (w.__nikkiFetchWrapped) return;
    w.__nikkiFetchWrapped = true;

    const original = window.fetch.bind(window);
    window.fetch = async (input: any, init?: any) => {
      const method = String(init?.method || (input && input.method) || "GET").toUpperCase();
      try {
        return await original(input, init);
      } catch (err) {
        if (method !== "GET" && method !== "HEAD") throw err;
        // A body can only be read once, so a retried Request must be cloned.
        await new Promise(r => setTimeout(r, 1200));
        return await original(
          typeof input === "string" ? input : input.clone ? input.clone() : input,
          init,
        );
      }
    };
  }, []);

  return null;
}
