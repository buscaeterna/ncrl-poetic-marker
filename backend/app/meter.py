"""Deterministic, explainable scansion of explicitly accented Russian text.

The module deliberately has no dictionary or statistical fallback.  A grave mark
after a vowel and ``ё`` are the only evidence of word stress.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from datetime import datetime, timezone

VERSION = "meter-1.0.0"
from .stress import VOWELS as STRESS_VOWELS, WORD as WORD_RE
VOWELS = set(STRESS_VOWELS)
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
                      "violations": [{"kind": "irregular_intervals", "intervals": intervals}], "regular": False})
    ranked = regular + [c for c in tonic if c["meter"] == "Дк"] + [c for c in tonic if c["meter"] == "Тк"] + [c for c in tonic if c["meter"] == "Ак"]
    if not ranked: ranked = sorted(candidates, key=lambda c: (len(c["violations"]), [f[0] for f in FEET].index(c["meter"])))[:3]
    last = stresses[-1] if stresses else None
    clause = CLAUSES[min(3, len(syllables) - last - 1)] if last is not None else None
    quality = ("insufficient" if not syllables or unknown_words or not stresses else
               "ambiguous" if len(ranked) > 1 else
               "exact" if not ranked[0]["violations"] else "probable")
    selected = ranked[0] if quality != "insufficient" else None
    explanation = ("Недостаточно подтверждённых ударений; проверьте: " + ", ".join(w["text"] for w in unknown_words)) if quality == "insufficient" else f"Выбран {selected['meter']} по приоритету R011; наблюдаемые нарушения: {len(selected['violations'])}."
    now = datetime.now(timezone.utc).isoformat()
    return {"sourceText": text, "sourceHash": hashlib.sha256(text.encode()).hexdigest(), "analyzerVersion": VERSION,
            "syllables": syllables, "words": words, "accentSequence": "".join("1" if s["stress"] == "stressed" else "?" if s["stress"] == "unknown" else "0" for s in syllables),
            "candidates": ranked, "selected": selected, "clause": clause, "unknownWords": unknown_words,
            "explanation": explanation, "quality": quality, "state": "pending", "analysedAt": now,
            "warnings": ["manual_review"] if quality == "insufficient" else []}


def source_signature(results: list[dict]) -> str:
    return hashlib.sha256("\n".join(f"{r['lineId']}:{r['sourceHash']}" for r in results).encode()).hexdigest()

def suggestion_is_current(result: dict) -> bool:
    return (result.get("state") in {"pending", "accepted"} and result.get("analyzerVersion") == VERSION
            and result.get("sourceText") is not None
            and result.get("sourceHash") == hashlib.sha256(result["sourceText"].encode()).hexdigest())

def summarise_poem(poem_id: str, results: list[dict]) -> dict:
    """Use a stable line majority only as explainable context, never as proof."""
    current = [r for r in results if suggestion_is_current(r)]
    excluded = [r.get("lineId") for r in results if not suggestion_is_current(r)]
    # An ambiguous line is an observation, not independent evidence.  Likewise a
    # candidate resolved by an earlier poem context cannot bootstrap that context.
    basis = [r for r in current if r.get("selected") and r.get("quality") in {"exact", "probable"} and not r.get("contextResolved")]
    initial = [r["selected"]["meter"] for r in basis]
    basis_counts = Counter(initial)
    leaders = basis_counts.most_common()
    tied = bool(leaders and len([count for _, count in leaders if count == leaders[0][1]]) > 1)
    dominant = leaders[0][0] if leaders and not tied else None
    for result in current:
        matching = [c for c in result["candidates"] if c["meter"] == dominant]
        if dominant and result["quality"] == "ambiguous" and matching:
            result["selected"] = matching[0]; result["quality"] = "probable"
            result["contextResolved"] = True
            result["explanation"] += f" Контекст произведения поддерживает {dominant}; требуется проверка."
    meters = Counter(r["selected"]["meter"] for r in current if r.get("selected") and r["quality"] != "ambiguous")
    warnings = [{"rule":"R011","message":"Применён приоритет регулярных интерпретаций."}]
    if excluded: warnings.append({"rule":"manual_review","message":"Устаревшие, отклонённые или несовместимые предложения исключены из сводки."})
    if not basis: warnings.append({"rule":"manual_review","message":"Нет независимых exact/probable строк для определения доминирующего метра."})
    if tied: warnings.append({"rule":"manual_review","message":"Подтверждённые метры имеют равную частоту; доминирующий метр не выбран."})
    outliers = [r for r in current if dominant and r.get("selected") and r["quality"] != "ambiguous" and r["selected"]["meter"] != dominant]
    if dominant == "Дк" and any(r.get("selected") and r["selected"]["meter"] == "Ак" for r in current): warnings.append({"rule":"R012","message":"Ак внутри дольникового каркаса следует повторно проверить как Дк."})
    if any(r.get("selected") and (r["selected"]["anacrusis"] > 2 or any(v.get("kind")=="irregular_intervals" for v in r["selected"]["violations"])) for r in current): warnings.append({"rule":"R013","message":"Анакруса или длинный интервал не создают дополнительный икт автоматически."})
    if outliers: warnings += [{"rule":"R014","message":"Наблюдаются отклонения; их статус требует ручного решения."},{"rule":"R015","message":"Не назначать Вл по отдельным отклонениям."},{"rule":"R016","message":"Гетерометрия/полиметрия не выводится числовым порогом; требуется manual_review."}]
    if any("¦" in r["sourceText"] for r in current): warnings.append({"rule":"R017","message":"Виртуальное объединение графических фрагментов требует manual_review."})
    signature = source_signature(current)
    alternatives = [m for m, _ in meters.most_common() if m != dominant]
    exact_feet = [r["selected"]["feetOrIctuses"] for r in current if r.get("selected") and r["selected"]["meter"] == dominant]
    uniform_feet = len(set(exact_feet)) == 1
    clauses = [r["clause"] for r in current if r.get("selected") and r["selected"]["meter"] == dominant and r.get("clause")]
    uniform_clause = len(set(clauses)) == 1
    formalised = bool(dominant and not excluded and not outliers and uniform_feet and all(r["quality"] in {"exact","probable"} for r in current))
    stopness = str(exact_feet[0]) if formalised and exact_feet else ""
    # No confirmed source defines compression of an alternating clausula sequence.
    # Preserve the observed order separately and only emit a formula for uniformity.
    formula = f"{dominant}{stopness}{clauses[0]}" if formalised and uniform_clause and clauses else ""
    if formalised and not uniform_clause: warnings.append({"rule":"manual_review","message":"Порядок клаузул сохранён, но формат цикла не подтверждён; @формула оставлена пустой."})
    return {"poemId": poem_id, "lineSuggestions": results, "dominantMeter": dominant, "alternatives": alternatives,
            "distribution": dict(meters), "heterometryPossible": None, "suggestedSegments": [], "observedClauseSequence": clauses,
            "metadataSuggestion": {"meter": dominant if formalised else "", "formula": formula, "stopness": stopness,
                                   "clause":clauses[0] if formalised and uniform_clause and clauses else "", "clauseSequence":clauses,
                                   "sourceSignature":signature,"state":"pending","acceptedFields":[],"explanation":"Формализация подтверждена." if formalised else "Недостаточно правил: заполните метаданные вручную."},
            "warnings": warnings, "excludedLineIds":excluded, "reviewLineIds": [r["lineId"] for r in results if r["quality"] in {"ambiguous", "insufficient"}], "sourceSignature": signature, "state":"pending"}

def analyse_poem(poem_id: str, lines: list[dict]) -> dict:
    return summarise_poem(poem_id, [{"lineId": str(line.get("id")), **analyse_line(line.get("text", ""))} for line in lines])
