"""Make a Nikki reply speakable by a Telugu-only acoustic model.

The AI4Bharat Telugu FastPitch was trained on Telugu-script text only. Its
character table has no Latin letters and no digits, and Coqui silently drops
characters it does not know — so "మా team WhatsApp లో confirm చేస్తారు"
would come out as "మా లో చేస్తారు": the words that carry the meaning vanish
without an error. Nikki's replies are routinely code-mixed (Hey Nikki,
WhatsApp, demo, appointment, GST), so every Latin word is rewritten in
Telugu script before synthesis:

  1. a lexicon of the words Nikki actually says (taken from pipeline.log),
     spelled the way a Telugu speaker says them;
  2. all-caps acronyms (AI, GST, SMS) spelled out letter by letter;
  3. anything else through a crude letter-to-sound pass. English spelling
     is irregular, so this is approximate — but a roughly-pronounced word
     beats a missing one.

Upstream's own engine solves this with IndicXlit, a fairseq transformer
that pins an old Python and torch. That is a large dependency for a
fallback voice; the lexicon covers the words that recur on real calls.
"""
from __future__ import annotations

import re

# ── words Nikki says, as a Telugu speaker says them ─────────────────────────
LEXICON = {
    "hey": "హే", "hi": "హాయ్", "hello": "హలో", "nikki": "నిక్కి",
    "whatsapp": "వాట్సాప్", "demo": "డెమో", "demos": "డెమోలు",
    "appointment": "అపాయింట్‌మెంట్", "appointments": "అపాయింట్‌మెంట్స్",
    "team": "టీమ్", "confirm": "కన్ఫర్మ్", "confirmed": "కన్ఫర్మ్డ్",
    "sure": "షూర్", "ok": "ఓకే", "okay": "ఓకే", "bye": "బై", "super": "సూపర్",
    "thank": "థాంక్", "thanks": "థాంక్స్", "you": "యూ", "please": "ప్లీజ్",
    "sorry": "సారీ", "yes": "యెస్", "no": "నో", "sir": "సర్", "madam": "మేడమ్",
    "call": "కాల్", "calls": "కాల్స్", "callback": "కాల్‌బ్యాక్", "cut": "కట్",
    "book": "బుక్", "booking": "బుకింగ్", "booked": "బుక్డ్", "order": "ఆర్డర్",
    "number": "నంబర్", "phone": "ఫోన్", "mobile": "మొబైల్", "message": "మెసేజ్",
    "clinic": "క్లినిక్", "doctor": "డాక్టర్", "hospital": "హాస్పిటల్",
    "service": "సర్వీస్", "services": "సర్వీసెస్", "business": "బిజినెస్",
    "website": "వెబ్‌సైట్", "app": "యాప్", "apps": "యాప్స్", "software": "సాఫ్ట్‌వేర్",
    "price": "ప్రైస్", "prices": "ప్రైసెస్", "discount": "డిస్కౌంట్",
    "offer": "ఆఫర్", "free": "ఫ్రీ", "details": "డీటెయిల్స్", "plan": "ప్లాన్",
    "plans": "ప్లాన్స్", "starter": "స్టార్టర్", "growth": "గ్రోత్", "pro": "ప్రో",
    "english": "ఇంగ్లీష్", "telugu": "తెలుగు", "hindi": "హిందీ",
    "online": "ఆన్‌లైన్", "link": "లింక్", "email": "ఈమెయిల్", "time": "టైమ్",
    "today": "టుడే", "tomorrow": "టుమారో", "morning": "మార్నింగ్",
    "evening": "ఈవెనింగ్", "afternoon": "ఆఫ్టర్‌నూన్", "night": "నైట్",
    "monday": "మండే", "tuesday": "ట్యూస్‌డే", "wednesday": "వెన్స్‌డే",
    "thursday": "థర్స్‌డే", "friday": "ఫ్రైడే", "saturday": "సాటర్‌డే",
    "sunday": "సండే", "to": "టు", "and": "అండ్", "the": "ద", "of": "ఆఫ్",
    "for": "ఫర్", "is": "ఈజ్", "it": "ఇట్", "a": "ఎ", "in": "ఇన్", "on": "ఆన్",
    "receptionist": "రిసెప్షనిస్ట్", "follow": "ఫాలో", "up": "అప్",
    "missed": "మిస్డ్", "miss": "మిస్", "customer": "కస్టమర్", "customers": "కస్టమర్స్",
    "andi": "అండి", "garu": "గారు", "ki": "కి", "lo": "లో", "chesthunanu": "చేస్తున్నాను",
    "tappakunda": "తప్పకుండా", "vacheyandi": "వచ్చేయండి", "cheyandi": "చేయండి",
    "bismillah": "బిస్మిల్లా", "hyderabad": "హైదరాబాద్", "kartik": "కార్తిక్",
    "let's": "లెట్స్", "switch": "స్విచ్", "what": "వాట్", "would": "వుడ్",
    "like": "లైక్", "know": "నో", "about": "అబౌట్", "how": "హౌ", "can": "కెన్",
    "help": "హెల్ప్", "your": "యువర్", "we": "వి", "will": "విల్",
}

# Letter names, for acronyms: "GST" is said జీ ఎస్ టీ, never "gust".
LETTERS = {
    "a": "ఏ", "b": "బీ", "c": "సీ", "d": "డీ", "e": "ఈ", "f": "ఎఫ్", "g": "జీ",
    "h": "హెచ్", "i": "ఐ", "j": "జే", "k": "కే", "l": "ఎల్", "m": "ఎం", "n": "ఎన్",
    "o": "ఓ", "p": "పీ", "q": "క్యూ", "r": "ఆర్", "s": "ఎస్", "t": "టీ", "u": "యూ",
    "v": "వీ", "w": "డబ్ల్యూ", "x": "ఎక్స్", "y": "వై", "z": "జెడ్",
}

# ── crude letter-to-sound for everything else ───────────────────────────────
_VIRAMA = "్"
_CONS = [  # longest first
    ("tion", "షన్"), ("sh", "ష"), ("ch", "చ"), ("th", "త"), ("ph", "ఫ"),
    ("kh", "ఖ"), ("gh", "ఘ"), ("bh", "భ"), ("dh", "ధ"), ("ck", "క"),
    ("k", "క"), ("g", "గ"), ("c", "క"), ("j", "జ"), ("t", "ట"), ("d", "డ"),
    ("n", "న"), ("p", "ప"), ("b", "బ"), ("m", "మ"), ("y", "య"), ("r", "ర"),
    ("l", "ల"), ("v", "వ"), ("w", "వ"), ("s", "స"), ("h", "హ"), ("f", "ఫ"),
    ("z", "జ"), ("x", "క్స"), ("q", "క"),
]
# (spelling, independent vowel, matra)
_VOW = [
    ("aa", "ఆ", "ా"), ("ee", "ఈ", "ీ"), ("ea", "ఈ", "ీ"), ("oo", "ఊ", "ూ"),
    ("ai", "ఐ", "ై"), ("ay", "ఏ", "ే"), ("ey", "ఏ", "ే"), ("au", "ఔ", "ౌ"),
    ("ou", "ఔ", "ౌ"), ("oa", "ఓ", "ో"), ("a", "అ", ""), ("e", "ఎ", "ె"),
    ("i", "ఇ", "ి"), ("o", "ఒ", "ొ"), ("u", "ఉ", "ు"),
]


def _xlit(word: str) -> str:
    w = word.lower()
    if len(w) > 3 and w.endswith("e") and w[-2] not in "aeiou":
        w = w[:-1]                       # silent final e: "late" -> "lat"
    out, i, pending = [], 0, False       # pending: a consonant awaits a vowel
    while i < len(w):
        if w[i] == "y" and pending and (i == len(w) - 1):
            out.append("ీ"); pending = False; i += 1; continue   # "happy"
        for sp, ind, mat in _VOW:
            if w.startswith(sp, i):
                out.append(mat if pending else ind)
                pending = False; i += len(sp); break
        else:
            for sp, tel in _CONS:
                if w.startswith(sp, i):
                    if pending:
                        out.append(_VIRAMA)
                    out.append(tel)
                    pending = not tel.endswith(_VIRAMA)
                    i += len(sp); break
            else:
                i += 1                   # apostrophe etc.
    if pending:
        out.append(_VIRAMA)
    return "".join(out)


def latin_word_to_telugu(word: str) -> str:
    low = word.lower()
    if low in LEXICON:
        return LEXICON[low]
    if word.isupper() and 1 < len(word) <= 5:
        return " ".join(LETTERS[c] for c in low if c in LETTERS)
    return _xlit(word)


# ── digits, as a safety net ─────────────────────────────────────────────────
# normalize_for_tts in the pipeline already speaks numbers in words; these
# only catch a numeral that slips past it, so they stay simple.
_ONES = ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు",
         "ఎనిమిది", "తొమ్మిది", "పది", "పదకొండు", "పన్నెండు", "పదమూడు",
         "పద్నాలుగు", "పదిహేను", "పదహారు", "పదిహేడు", "పద్దెనిమిది", "పందొమ్మిది"]
_TENS = {2: "ఇరవై", 3: "ముప్పై", 4: "నలభై", 5: "యాభై", 6: "అరవై", 7: "డెబ్బై",
         8: "ఎనభై", 9: "తొంభై"}


def _num(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return _TENS[t] + ("" if o == 0 else " " + _ONES[o])
    if n < 1000:
        h, r = divmod(n, 100)
        head = "వంద" if h == 1 else _ONES[h] + " వంద"
        return head + ("లు" if r == 0 else "ల " + _num(r))
    if n < 100000:
        th, r = divmod(n, 1000)
        head = "వెయ్యి" if th == 1 else _num(th) + " వేలు"
        return head if r == 0 else (head if th == 1 else head[:-1]) + " " + _num(r)
    return " ".join(_ONES[int(d)] for d in str(n))


def _digits(m: re.Match) -> str:
    s = m.group(0)
    if len(s) >= 5 or s.startswith("0"):
        return " ".join(_ONES[int(d)] for d in s)   # phone numbers, PINs
    return _num(int(s))


_LATIN = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_DIGITS = re.compile(r"\d+")


def normalise(text: str, allowed: set | None = None) -> str:
    """Telugu-script text the model can say. `allowed` is the model's
    character set; anything still outside it is dropped explicitly here
    rather than by Coqui, so the server can log what was lost."""
    text = text.replace("END_CALL", " ")
    text = text.replace("%", " శాతం")
    text = _DIGITS.sub(_digits, text)
    text = _LATIN.sub(lambda m: latin_word_to_telugu(m.group(0)), text)
    text = re.sub(r"[\"“”‘’`*_#~^|<>\[\]{}()/\\]", " ", text)
    text = text.replace("…", ",").replace("...", ",").replace("–", ",").replace("—", ",")
    if allowed is not None:
        text = "".join(c if (c in allowed or c.isspace()) else " " for c in text)
    return re.sub(r"\s+", " ", text).strip()
