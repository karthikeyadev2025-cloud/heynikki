// Every word printed on the flyer and the auto poster, in both languages.
// Keep the two languages saying the same thing: the flyer prints Telugu on
// the front and English on the back, and a reader who turns it over should
// find the same offer, not a different one.
//
// Prices and the phone number mirror web/app/page.tsx — change them there
// first, then here.

export const PHONE_DISPLAY = "+91 86335 02031";
export const PHONE_SHORT = "86335 02031";
export const WEBSITE = "heynikki.in";

export const te = {
  lang: "te",
  tag: "తెలుగు AI రిసెప్షనిస్ట్",
  headline: ["ఒక్క కాల్ కూడా", "ఇక మిస్ అవ్వదు!"],
  sub: "మీరు బిజీగా ఉన్నా, షాప్ మూసేసినా — నిక్కీ మీ ఫోన్ ఎత్తి కస్టమర్‌తో తెలుగులో మాట్లాడుతుంది.",
  pain: "మిస్డ్ కాల్ = పోయిన కస్టమర్",
  howTitle: "ఎలా పనిచేస్తుంది?",
  steps: [
    "కస్టమర్ మీ నంబర్‌కి కాల్ చేస్తారు",
    "నిక్కీ తెలుగులో మాట్లాడి అపాయింట్‌మెంట్ / ఆర్డర్ తీసుకుంటుంది",
    "కస్టమర్‌కి వాట్సాప్‌లో కన్ఫర్మేషన్ వెళ్తుంది",
  ],
  whyTitle: "ఎందుకు నిక్కీ?",
  why: [
    ["24 గంటలూ పనిచేస్తుంది", "సెలవు లేదు, జీతం లేదు"],
    ["మూడు భాషలు", "తెలుగు, హిందీ, ఇంగ్లీష్"],
    ["మీ నంబర్ మారదు", "బోర్డ్, విజిటింగ్ కార్డ్ అలాగే"],
    ["ప్రతి కాల్ మీ ఫోన్‌లో", "ఎవరు, ఏం అడిగారు — అన్నీ"],
  ],
  forTitle: "ఎవరికి?",
  forList: ["క్లినిక్‌లు", "సెలూన్‌లు", "హోటళ్లు", "రియల్ ఎస్టేట్", "షాపులు"],
  offer: "మొదటి 100 నిమిషాలు ఉచితం",
  offerSub: "కార్డ్ అవసరం లేదు · తర్వాత నెలకు ₹3,999 నుంచి",
  cta: "నిక్కీతో మీరే మాట్లాడి చూడండి!",
  ctaSub: "ఇప్పుడే కాల్ చేయండి",
  scan: "స్కాన్ చేసి కాల్ చేయండి",
  // Auto poster: read from the vehicle behind in a few seconds, so four
  // lines and a phone number, nothing else.
  autoHeadline: ["కాల్ మిస్ అయితే,", "కస్టమర్ మిస్!"],
  autoSub: "మీ బిజినెస్ ఫోన్‌కి తెలుగులో జవాబిచ్చే AI రిసెప్షనిస్ట్ — 24 గంటలూ",
  autoCall: "నిక్కీతో మాట్లాడండి",
  autoFree: "100 నిమిషాలు ఉచితం",
};

export const en = {
  lang: "en",
  tag: "AI receptionist that speaks Telugu",
  headline: ["Never miss a", "customer call again!"],
  sub: "Busy with a customer, or shop closed? Nikki picks up your phone and talks to the caller in Telugu.",
  pain: "Missed call = Lost customer",
  howTitle: "How it works",
  steps: [
    "Customer calls your number",
    "Nikki talks in Telugu and books the appointment / takes the order",
    "Customer gets a WhatsApp confirmation",
  ],
  whyTitle: "Why Nikki?",
  why: [
    ["Works 24 hours", "No leave, no salary"],
    ["Three languages", "Telugu, Hindi, English"],
    ["Keep your number", "Boards & visiting cards stay"],
    ["Every call on your phone", "Who called, what they asked"],
  ],
  forTitle: "Made for",
  forList: ["Clinics", "Salons", "Restaurants", "Real estate", "Shops"],
  offer: "First 100 minutes FREE",
  offerSub: "No card needed · Then from ₹3,999 / month",
  cta: "Talk to Nikki yourself!",
  ctaSub: "Call now",
  scan: "Scan to call",
  autoHeadline: ["Missed call =", "Missed customer!"],
  autoSub: "AI receptionist that answers your business phone in Telugu, 24 hours",
  autoCall: "Call & talk to Nikki",
  autoFree: "100 minutes FREE",
};
