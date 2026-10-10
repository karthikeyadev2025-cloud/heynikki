/**
 * What a customer's WhatsApp message contains, beyond text.
 *
 * The webhook kept `m.text?.body ?? "[image]"` — so a photo a customer sent
 * arrived in the inbox as the word "[image]" and the picture itself was
 * gone: Meta hands over a media id, not the file, and the id was never
 * stored. For a number that cannot be opened in the WhatsApp app (it is on
 * the Cloud API), that made every photo, voice note and document unreadable
 * anywhere.
 *
 * This reads one webhook message into what the inbox stores: the words
 * (text, a caption, the button pressed, a shared place), and for media the
 * id Meta will serve the file under.
 */
export type InboundParts = {
  body: string;
  media_id: string | null;
  media_mime: string | null;
  media_name: string | null;
};

const MEDIA = ["image", "video", "audio", "document", "sticker"] as const;

export function inboundParts(m: any): InboundParts {
  const type = String(m?.type || "text");
  const none = { media_id: null, media_mime: null, media_name: null };
  if ((MEDIA as readonly string[]).includes(type)) {
    const o = m[type] || {};
    return {
      body: String(o.caption || `[${type === "audio" && o.voice ? "voice note" : type}]`),
      media_id: o.id ? String(o.id) : null,
      media_mime: o.mime_type ? String(o.mime_type).split(";")[0].trim() : null,
      media_name: o.filename ? String(o.filename).slice(0, 200) : null,
    };
  }
  if (type === "button" && m.button?.text) return { body: String(m.button.text), ...none };
  if (type === "interactive") {
    const r = m.interactive?.button_reply || m.interactive?.list_reply;
    if (r?.title) return { body: String(r.title), ...none };
  }
  if (type === "location" && m.location) {
    const { latitude, longitude, name, address } = m.location;
    const place = [name, address].filter(Boolean).join(", ");
    return { body: `${place ? place + "\n" : ""}https://maps.google.com/?q=${latitude},${longitude}`, ...none };
  }
  if (type === "contacts" && Array.isArray(m.contacts)) {
    const lines = m.contacts.map((c: any) =>
      [c?.name?.formatted_name, ...(c?.phones || []).map((p: any) => p?.phone)].filter(Boolean).join(" · "));
    if (lines.some(Boolean)) return { body: `Contact: ${lines.filter(Boolean).join("\n")}`, ...none };
  }
  if (type === "reaction" && m.reaction?.emoji) return { body: `Reacted ${m.reaction.emoji}`, ...none };
  return { body: String(m?.text?.body ?? `[${type}]`), ...none };
}
