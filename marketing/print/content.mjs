// Every word printed on the A5 flyer and the auto poster.
//
// Written the way a shop owner in Guntur talks: Telugu sentences, with the
// English words everyone already uses (call, order, booking, WhatsApp,
// customer) left in English letters. Not pure Telugu, which reads stiff,
// and not pure English, which half the readers skim past.
//
// The whole flyer is about one idea, the missed call: show it, say why it
// costs money, then say Nikki picks up when you can't.
//
// Prices and the phone number mirror web/app/page.tsx — change them there
// first, then here.

export const PHONE_DISPLAY = "+91 86335 02031";
export const PHONE_SHORT = "86335 02031";
export const WEBSITE = "heynikki.in";

export const mix = {
  lang: "te",
  tag: "తెలుగు AI Receptionist",
  kicker: "మీ phone లో ఇది రోజూ చూస్తున్నారా?",
  // The notification card drawn under the kicker.
  notif: ["3 Missed Calls", "New customer · ఉదయం 11:42"],
  headline: ["Missed Call", "= పోయిన Customer"],
  whyTitle: "Missed call ఎందుకు నష్టం?",
  why: [
    ["మళ్ళీ call చేయరు", "Customer వెంటనే పక్క shop కి call చేస్తారు"],
    ["Busy గా ఉన్నప్పుడే వస్తుంది", "Customer తో ఉన్నప్పుడు, driving లో, రాత్రి"],
    ["డబ్బు పోతుంది", "ప్రతి missed call = ఒక order / appointment నష్టం"],
  ],
  fixTitle: "మీరు ఎత్తలేకపోతే, Nikki ఎత్తుతుంది",
  flow: ["Call వస్తుంది", "Nikki తెలుగులో మాట్లాడుతుంది", "Booking + WhatsApp confirmation"],
  ticks: ["24 గంటలూ", "తెలుగు · Hindi · English", "మీ number మారదు"],
  offer: "మొదటి 100 నిమిషాలు FREE",
  offerSub: "Card అవసరం లేదు · తర్వాత నెలకు ₹3,999 నుంచి",
  cta: "Nikki తో మీరే మాట్లాడి చూడండి — ఇప్పుడే call చేయండి!",
  scan: "Scan చేసి call చేయండి",
  // Auto poster: read from the vehicle behind in a few seconds, so the
  // missed-call line, one line of answer, and the phone number.
  autoHeadline: ["Call Miss అయితే,", "Customer Miss!"],
  autoSub: "మీరు phone ఎత్తలేకపోతే, Nikki ఎత్తుతుంది — తెలుగులో, 24 గంటలూ",
  autoCall: "Nikki తో మాట్లాడండి",
  autoFree: "100 నిమిషాలు FREE",
};
