// The A4 brochure: every feature on the homepage.
// Front = Nikki (the AI). Back = the Desk (your telecallers), plans, call to action.
//
// Same voice as content.mjs: Telugu sentences, everyday English words in
// English letters, the way a business owner in Guntur actually talks.
//
// Each line mirrors a card on web/app/page.tsx ("What she does", "Your side
// of it", "A Desk for the people who call", "Two brains", the industries and
// the plans). Change the site first, then here, so the paper never promises
// what the product does not do.

export const mix = {
  lang: "te",
  tag: "AI Receptionist + Telecaller Desk",
  headline: ["Nikki call ఎత్తుతుంది,", "మీ Team call చేస్తుంది."],
  sub: "ఒకే number — AI, మీ staff కలిసి పని చేస్తారు. Nikki ప్రతి call కి తెలుగు, Hindi లేదా English లో మాట్లాడుతుంది. మీ telecallers కి ఎవరికి call చేయాలో Desk చెబుతుంది.",
  pain: "ఇక missed call లేదు = ఇక పోయిన customer లేదు",

  howTitle: "Call ఎలా జరుగుతుంది?",
  how: [
    "Customer మీ number కే call చేస్తారు",
    "Nikki వాళ్ల భాషలోనే మాట్లాడుతుంది",
    "Phone పెట్టేలోపే WhatsApp confirmation",
  ],

  aiTitle: "Nikki (AI) ఏం చేస్తుంది?",
  ai: [
    ["Appointments book చేస్తుంది", "మీ diary చూసి free slot చెబుతుంది, booking number కూడా చెబుతుంది"],
    ["Orders తీసుకుంటుంది", "మీ price list నుంచే rate చెబుతుంది, address తీసుకుని total చదివి వినిపిస్తుంది"],
    ["Regular customers ని గుర్తుపెట్టుకుంటుంది", "మళ్ళీ call చేసినవాళ్లను address మళ్ళీ అడగదు"],
    ["మీ staff కి call transfer", "\"మనిషితో మాట్లాడాలి\" అంటే అదే call లో మీ staff కి ఇస్తుంది"],
    ["Customers కి call back చేస్తుంది", "Reminders, \"మీ order ready\", ఎవరూ reply ఇవ్వని enquiries"],
    ["WhatsApp లో confirm చేస్తుంది", "Booking, order, reminder — అన్నీ written గా"],
    ["Road noise లోనూ వింటుంది", "Horn sound కీ, customer voice కీ తేడా తెలుసు"],
    ["AI అని నిజాయితీగా చెబుతుంది", "తాను మనిషినని ఎప్పుడూ చెప్పదు"],
  ],

  ownerTitle: "Control మీ చేతిలోనే",
  owner: [
    ["Dashboard", "Call recordings, transcripts, diary, leads, orders — అన్నీ ఒకేచోట"],
    ["\"Hey Nikki\" App", "Android phone లో పేరు పిలిచి అడగండి — ఈరోజు numbers, ఎవరికి call back చేయాలి"],
    ["చెప్పండి, చేస్తుంది", "\"ఆ customer కి call చేసి report ready అని చెప్పు\" — మీరు OK అన్నాకే call"],
    ["API & Webhooks", "మీ సొంత software తో connect చేయండి (Business plan)"],
  ],
  turnOver: "వెనుక వైపు: Telecaller Desk & Plans",

  deskTag: "మీ Staff కోసం",
  deskTitle: "Telecaller Desk — మీ Team కోసం",
  deskSub: "Nikki calls ఎత్తుతుంది; మీ team calls చేస్తుంది. ప్రతి ఒక్కరికీ ఒక Desk — అవే numbers, అదే dashboard.",
  desk: [
    ["Next call ఎవరికో చెబుతుంది", "ముందు due callbacks, తర్వాత hot leads. ఒక్క tap తో call"],
    ["Callback reminders", "\"మంగళవారం 4 కి call చేయండి\" — 10 నిమిషాల ముందే phone గుర్తుచేస్తుంది"],
    ["Customer details screen పై", "పాత calls, ఏం మాట్లాడారు, bookings, orders — hello అనకముందే"],
    ["Auto call summary", "Recording నుంచి 2 lines summary + next step suggestion"],
    ["ప్రతి ఒక్కరికీ సొంత number", "Customer కి ఎప్పుడూ అదే number కనిపిస్తుంది"],
    ["Daily report", "ఒక్కొక్కరి calls, bookings; రోజూ సాయంత్రం customers అడిగిన questions, objections"],
  ],

  brainsTitle: "AI + Human. ఒకే Number.",
  brains: [
    ["AI Brain", "Answer చేస్తుంది, book చేస్తుంది, confirm చేస్తుంది. రాత్రి 11 కి కూడా విసుగు లేదు"],
    ["ఒకే Number", "Customer మళ్ళీ dial చేయక్కర్లేదు. మీ brand అలాగే ఉంటుంది"],
    ["Human Brain", "మీ telecaller అదే call లో — తనకంటూ ఒక Desk తో"],
  ],

  forTitle: "ఎవరి కోసం?",
  forList: ["Schools, Colleges, Coaching", "Hospitals", "Clinics", "Real Estate", "Consultancies", "Insurance", "Loan Recovery", "Factories & Companies"],

  plansTitle: "Plans",
  perMonth: "/ నెల",
  popular: "ఎక్కువమంది తీసుకునేది",
  plans: [
    ["Shop", "3,999", ["400 Nikki + 300 Telecaller నిమిషాలు", "1 Number · 1 వ్యక్తి", "Telecaller Desk + Call summaries"]],
    ["Team", "9,999", ["1,000 Nikki + 1,500 Telecaller నిమిషాలు", "2 Numbers · 3 మంది", "Outbound campaigns + కొత్త leads కి auto call back"]],
    ["Business", "24,999", ["2,500 Nikki + 3,500 Telecaller నిమిషాలు", "5 Numbers · 8 మంది", "API + Priority WhatsApp support"]],
  ],

  offer: "మొదటి 100 నిమిషాలు FREE",
  offerSub: "Card అవసరం లేదు · మీ number మారదు",
  cta: "Nikki తో మీరే మాట్లాడి చూడండి — ఇప్పుడే call చేయండి!",
  scan: "Scan చేసి call చేయండి",
};
