/**
 * The number as Meta wants it: country code, digits only, no "+".
 *
 * Bare digits were sent as typed. A ten-digit number only worked because
 * Meta assumes the sender's country code when there is none; "09849…"
 * (a leading trunk 0) became 91-09849… and went nowhere, and a landline —
 * 4045208195 on 7 Oct — was tried and failed. Indian numbers are made
 * explicit, and an Indian number that cannot be a mobile is refused before
 * it costs a send: a landline has no WhatsApp.
 */
export function waMsisdn(to: string): { ok: true; msisdn: string } | { ok: false; error: string } {
  let d = String(to || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return { ok: false, error: `not a WhatsApp number: ${to}` };
  if (d.startsWith("91") && d.length === 12 && !/^[6-9]/.test(d.slice(2))) {
    return { ok: false, error: `not a mobile number (no WhatsApp): ${to}` };
  }
  return { ok: true, msisdn: d };
}
