/**
 * What is kept of an inbound WhatsApp message — a photo used to arrive as
 * the word "[image]" with the picture gone.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { inboundParts } = await import("../dist/wa-inbound.js");
const none = { media_id: null, media_mime: null, media_name: null };

test("text is the body, with no media", () => {
  assert.deepEqual(inboundParts({ type: "text", text: { body: "hi" } }), { body: "hi", ...none });
});

test("a photo keeps its media id, type and caption", () => {
  assert.deepEqual(inboundParts({ type: "image", image: { id: "123", mime_type: "image/jpeg", caption: "our shop" } }),
    { body: "our shop", media_id: "123", media_mime: "image/jpeg", media_name: null });
  assert.equal(inboundParts({ type: "image", image: { id: "123", mime_type: "image/jpeg" } }).body, "[image]");
});

test("a voice note and a document", () => {
  assert.deepEqual(inboundParts({ type: "audio", audio: { id: "9", mime_type: "audio/ogg; codecs=opus", voice: true } }),
    { body: "[voice note]", media_id: "9", media_mime: "audio/ogg", media_name: null });
  assert.deepEqual(inboundParts({ type: "document", document: { id: "7", mime_type: "application/pdf", filename: "quote.pdf" } }),
    { body: "[document]", media_id: "7", media_mime: "application/pdf", media_name: "quote.pdf" });
});

test("buttons, list replies, places and reactions become words", () => {
  assert.equal(inboundParts({ type: "button", button: { text: "Yes" } }).body, "Yes");
  assert.equal(inboundParts({ type: "interactive", interactive: { list_reply: { title: "Website" } } }).body, "Website");
  assert.equal(inboundParts({ type: "location", location: { latitude: 16.3, longitude: 80.4, name: "Guntur" } }).body,
    "Guntur\nhttps://maps.google.com/?q=16.3,80.4");
  assert.equal(inboundParts({ type: "reaction", reaction: { emoji: "👍" } }).body, "Reacted 👍");
});

test("an unknown type is named rather than dropped", () => {
  assert.deepEqual(inboundParts({ type: "order" }), { body: "[order]", ...none });
});
