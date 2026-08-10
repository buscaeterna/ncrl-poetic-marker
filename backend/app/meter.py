"""Deterministic, explainable scansion of explicitly accented Russian text.

The module deliberately has no dictionary or statistical fallback.  A grave mark
after a vowel and ``ё`` are the only evidence of word stress.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from datetime import datetime, timezone

VERSION = "meter-1.0.0"
VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯѣѢ")
WORD_RE = re.compile(r"[А-Яа-яЁёІіѢѣ]+(?:`|-[А-Яа-яЁёІіѢѣ]+)*", re.U)
FEET = (("Х", 2, 0), ("Я", 2, 1), ("Д", 3, 0), ("Аф", 3, 1), ("Ан", 3, 2))
CLAUSES = ("м", "ж", "д", "г")


def _syllables(text: str):
    words, syllables = [], []
    for wi, match in enumerate(WORD_RE.finditer(text)):
        word_syllables = []
        for pos in range(match.start(), match.end()):
            if text[pos] not in VOWELS:
                continue
            stressed = text[pos] in "ёЁ" or (pos + 1 < len(text) and text[pos + 1] == "`")
            item = {"index": len(syllables), "text": text[pos], "start": pos,
                    "end": pos + 1, "wordIndex": wi, "stress": "stressed" if stressed else "unstressed"}
            syllables.append(item); word_syllables.append(item)
        confirmed = [s for s in word_syllables if s["stress"] == "stressed"]
        unknown = len(word_syllables) > 1 and not confirmed
        if unknown:
            for syllable in word_syllables: syllable["stress"] = "unknown"
        words.append({"index": wi, "text": match.group(), "start": match.start(), "end": match.end(),
                      "syllableIndices": [s["index"] for s in word_syllables], "stressKnown": not unknown})
    return syllables, words


def _candidate(code, size, ictus, syllables, stresses):
    ictuses = list(range(ictus, len(syllables), size))
    omissions = [i for i in ictuses if syllables[i]["stress"] == "unstressed"]
    weak = [i for i in stresses if i % size != ictus]
    unknown = [i for i in ictuses if syllables[i]["stress"] == "unknown"]
    feet = max(1, (len(syllables) - ictus + size - 1) // size)
    violations = ([{"kind": "ictus_omission", "syllable": i} for i in omissions] +
                  [{"kind": "weak_stress", "syllable": i} for i in weak] +
                  [{"kind": "unknown_ictus", "syllable": i} for i in unknown])
    return {"meter": code, "feetOrIctuses": feet, "ictusPositions": ictuses, "anacrusis": ictus,
            "ictusOmissions": omissions, "weakStresses": weak, "violations": violations,
            "regular": not omissions and not weak and not unknown}


def analyse_line(text: str) -> dict:
    syllables, words = _syllables(text)
    stresses = [s["index"] for s in syllables if s["stress"] == "stressed"]
    unknown_words = [w for w in words if not w["stressKnown"]]
    candidates = [_candidate(*foot, syllables, stresses) for foot in FEET]
    regular = [c for c in candidates if c["regular"]]
    intervals = [b - a - 1 for a, b in zip(stresses, stresses[1:])]
    tonic = []
    if len(stresses) >= 2 and intervals and all(1 <= value <= 2 for value in intervals):
        tonic.append({"meter": "Дк", "feetOrIctuses": len(stresses), "ictusPositions": stresses,
                      "anacrusis": stresses[0], "ictusOmissions": [], "weakStresses": [], "violations": [], "regular": True})
    if len(stresses) >= 2 and intervals and all(0 <= value <= 3 for value in intervals):
        tonic.append({"meter": "Тк", "feetOrIctuses": len(stresses), "ictusPositions": stresses,
                      "anacrusis": stresses[0], "ictusOmissions": [], "weakStresses": [], "violations": [], "regular": True})
    # R011: only expose Ак as the selected interpretation after regular alternatives fail.
    if stresses and not regular and not tonic:
        tonic.append({"meter": "Ак", "feetOrIctuses": len(stresses), "ictusPositions": stresses,
                      "anacrusis": stresses[0], "ictusOmissions": [], "weakStresses": [],
                      "violations": [{"kind": "irregular_intervals", "intervals": intervals}], "regular": True})
    ranked = regular + [c for c in tonic if c["meter"] == "Дк"] + [c for c in tonic if c["meter"] == "Тк"] + [c for c in tonic if c["meter"] == "Ак"]
    if not ranked: ranked = sorted(candidates, key=lambda c: (len(c["violations"]), [f[0] for f in FEET].index(c["meter"])))[:3]
    last = stresses[-1] if stresses else None
    clause = CLAUSES[min(3, len(syllables) - last - 1)] if last is not None else None
    quality = "insufficient" if not syllables or unknown_words or not stresses else ("exact" if len(ranked) == 1 and ranked[0]["regular"] else "ambiguous" if len(ranked) > 1 else "probable")
    selected = ranked[0] if quality != "insufficient" else None
    explanation = ("Недостаточно подтверждённых ударений; проверьте: " + ", ".join(w["text"] for w in unknown_words)) if quality == "insufficient" else f"Выбран {selected['meter']} по приоритету R011; наблюдаемые нарушения: {len(selected['violations'])}."
    now = datetime.now(timezone.utc).isoformat()
    return {"sourceText": text, "sourceHash": hashlib.sha256(text.encode()).hexdigest(), "analyzerVersion": VERSION,
            "syllables": syllables, "words": words, "accentSequence": "".join("1" if s["stress"] == "stressed" else "?" if s["stress"] == "unknown" else "0" for s in syllables),
            "candidates": ranked, "selected": selected, "clause": clause, "unknownWords": unknown_words,
            "explanation": explanation, "quality": quality, "state": "pending", "analysedAt": now,
            "warnings": ["manual_review"] if quality == "insufficient" else []}


def analyse_poem(poem_id: str, lines: list[dict]) -> dict:
    results = [{"lineId": str(line.get("id")), **analyse_line(line.get("text", ""))} for line in lines]
    meters = Counter(r["selected"]["meter"] for r in results if r["selected"])
    dominant = meters.most_common(1)[0][0] if meters else None
    warnings = ["R011"]
    if dominant == "Дк" and any(r["selected"] and r["selected"]["meter"] == "Ак" for r in results): warnings.append("R012")
    if len(meters) > 1: warnings += ["R014", "R015", "R016"]
    if any("¦" in r["sourceText"] for r in results): warnings.append("R017")
    signature = hashlib.sha256("\n".join(f"{r['lineId']}:{r['sourceHash']}" for r in results).encode()).hexdigest()
    alternatives = [m for m, _ in meters.most_common() if m != dominant]
    exact_feet = [r["selected"]["feetOrIctuses"] for r in results if r["selected"] and r["selected"]["meter"] == dominant]
    stopness = str(Counter(exact_feet).most_common(1)[0][0]) if exact_feet else ""
    formula = "; ".join(f"{m}{f}{r['clause'] or '?'}" for r in results if (m := r["selected"]["meter"] if r["selected"] else None) for f in [r["selected"]["feetOrIctuses"]])
    return {"poemId": poem_id, "lineSuggestions": results, "dominantMeter": dominant, "alternatives": alternatives,
            "distribution": dict(meters), "heterometryPossible": len(meters) > 1, "suggestedSegments": [],
            "metadataSuggestion": {"meter": dominant or "", "formula": formula, "stopness": stopness},
            "warnings": list(dict.fromkeys(warnings)), "reviewLineIds": [r["lineId"] for r in results if r["quality"] in {"ambiguous", "insufficient"}], "sourceSignature": signature}
