// Every word printed on the flyer and the auto poster, in both languages.
// Keep the two languages saying the same thing: the flyer prints Telugu on
// the front and English on the back, and a reader who turns it over should
// find the same offer, not a different one.
//
// The whole piece is about one idea, the missed call: show it, say why it
// costs money, then say Nikki picks up when you can't. Anything that is not
// part of that story stays off the paper.
//
// Prices and the phone number mirror web/app/page.tsx — change them there
// first, then here.

export const PHONE_DISPLAY = "+91 86335 02031";
export const PHONE_SHORT = "86335 02031";
export const WEBSITE = "heynikki.in";

export const te = {
  lang: "te",
  tag: "తెలుగు AI రిసెప్షనిస్ట్",
  kicker: "మీ ఫోన్‌లో ఇది రోజూ చూస్తున్నారా?",
  // The notification card drawn under the kicker.
  notif: ["3 మిస్డ్ కాల్స్", "కొత్త కస్టమర్ · ఉదయం 11:42"],
  headline: ["మిస్డ్ కాల్", "= పోయిన కస్టమర్"],
  whyTitle: "మిస్డ్ కాల్ ఎందుకు నష్టం?",
  why: [
    ["మళ్ళీ కాల్ చేయరు", "కస్టమర్ వెంటనే పక్క షాప్‌కి కాల్ చేస్తారు"],
    ["బిజీగా ఉన్నప్పుడే వస్తుంది", "కస్టమర్‌తో ఉన్నప్పుడు, డ్రైవింగ్‌లో, రాత్రి"],
    ["డబ్బు పోతుంది", "ప్రతి మిస్డ్ కాల్ = ఒక ఆర్డర్ / అపాయింట్‌మెంట్ నష్టం"],
  ],
  fixTitle: "మీరు ఎత్తలేకపోతే, నిక్కీ ఎత్తుతుంది",
  flow: ["కాల్ వస్తుంది", "నిక్కీ తెలుగులో మాట్లాడుతుంది", "బుకింగ్ + వాట్సాప్ కన్ఫర్మేషన్"],
  ticks: ["24 గంటలూ", "తెలుగు · హిందీ · ఇంగ్లీష్", "మీ నంబర్ మారదు"],
  offer: "మొదటి 100 నిమిషాలు ఉచితం",
  offerSub: "కార్డ్ అవసరం లేదు · తర్వాత నెలకు ₹3,999 నుంచి",
  cta: "నిక్కీతో మీరే మాట్లాడి చూడండి! ఇప్పుడే కాల్ చేయండి",
  scan: "స్కాన్ చేసి కాల్ చేయండి",
  // Auto poster: read from the vehicle behind in a few seconds, so the
  // missed-call line, one line of answer, and the phone number.
  autoHeadline: ["కాల్ మిస్ అయితే,", "కస్టమర్ మిస్!"],
  autoSub: "మీరు ఫోన్ ఎత్తలేకపోతే, నిక్కీ ఎత్తుతుంది — తెలుగులో, 24 గంటలూ",
  autoCall: "నిక్కీతో మాట్లాడండి",
  autoFree: "100 నిమిషాలు ఉచితం",
};

export const en = {
  lang: "en",
  tag: "AI receptionist that speaks Telugu",
  kicker: "Do you see this on your phone every day?",
  notif: ["3 missed calls", "New customer · 11:42 AM"],
  headline: ["Missed call", "= Lost customer"],
  whyTitle: "Why a missed call costs you",
  why: [
    ["They don't call back", "The customer calls the next shop instead"],
    ["It rings when you're busy", "With a customer, driving, or at night"],
    ["You lose money", "Every missed call = a lost order or appointment"],
  ],
  fixTitle: "Can't pick up? Nikki will.",
  flow: ["Call comes in", "Nikki talks in Telugu", "Booking done + WhatsApp sent"],
  ticks: ["24 hours", "Telugu · Hindi · English", "Keep your same number"],
  offer: "First 100 minutes FREE",
  offerSub: "No card needed · Then from ₹3,999 / month",
  cta: "Talk to Nikki yourself! Call now",
  scan: "Scan to call",
  autoHeadline: ["Missed call =", "Missed customer!"],
  autoSub: "Can't pick up? Nikki will — in Telugu, 24 hours",
  autoCall: "Call & talk to Nikki",
  autoFree: "100 minutes FREE",
};
