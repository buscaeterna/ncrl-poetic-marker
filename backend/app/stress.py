"""Provider-neutral, lossless Russian word-stress analysis.

Providers return vowel offsets in the original token.  This adapter alone inserts
the NCRL backtick, so punctuation and whitespace can never be normalised by a model.
"""
from __future__ import annotations
from dataclasses import asdict, dataclass
from hashlib import sha256
from typing import Protocol
import re

VOWELS = "аеёиоуыэюяАЕЁИОУЫЭЮЯѢѣ"
# Backticks are allowed only directly after a vowel, including inside a word.
LETTER = r"А-Яа-яЁёІіѢѣ"
WORD = re.compile(rf"[{LETTER}](?:[{LETTER}]|(?<=[{VOWELS}])`)*(?:-[{LETTER}](?:[{LETTER}]|(?<=[{VOWELS}])`)*)*", re.UNICODE)

@dataclass(frozen=True)
class WordStress:
    original: str
    normalized: str
    position: int | None
    confidence: float
    alternatives: tuple[int, ...] = ()
    ambiguous: bool = False
    source: str = "model"
    warning: str | None = None

class StressProvider(Protocol):
    name: str
    version: str
    def analyse_word(self, word: str, context: str) -> WordStress: ...

class DeterministicProvider:
    """Small deterministic provider used in tests and as an explicit safe fallback."""
    name, version = "ncrl-test-dictionary", "1"
    dictionary = {"мороз": (3,), "погода": (3,), "говорит": (5,), "замок": (1, 3)}
    def analyse_word(self, word: str, context: str) -> WordStress:
        normalized = word.lower().replace("`", "")
        if "`" in word:
            return WordStress(word, normalized, word.index("`") - 1, 1, source="existing")
        yo = next((i for i, c in enumerate(word) if c in "ёЁ"), None)
        if yo is not None:
            return WordStress(word, normalized, yo, 1, source="ё")
        choices = self.dictionary.get(normalized, ())
        if choices:
            return WordStress(word, normalized, choices[0], .55 if len(choices)>1 else .95,
                              choices[1:], len(choices)>1, "dictionary",
                              "Требуется выбор омографа" if len(choices)>1 else None)
        vowels = [i for i,c in enumerate(word) if c in VOWELS]
        if len(vowels) == 1:
            return WordStress(word, normalized, vowels[0], .9, source="rule")
        return WordStress(word, normalized, None, 0, ambiguous=True, source="rule",
                          warning="Слово не найдено; нужна ручная проверка")

class SileroProvider:
    """Production adapter for the pinned, local Silero Stress package."""
    name="silero-stress"
    def __init__(self, version: str):
        from silero_stress import load_accentor
        self.version=version;self.accentor=load_accentor();self._tokens=[];self._index=0
    def begin_line(self, context: str):
        predicted=self.accentor(context.replace("`",""))
        self._tokens=[m.group() for m in re.finditer(r"[+А-Яа-яЁёІіѢѣ-]+",predicted)];self._index=0
    def analyse_word(self, word: str, context: str) -> WordStress:
        normalized=word.lower().replace("`","")
        predicted=self._tokens[self._index] if self._index<len(self._tokens) else word;self._index+=1
        if "`" in word:return WordStress(word,normalized,word.index("`")-1,1,source="existing")
        yo=next((i for i,c in enumerate(word) if c in "ёЁ"),None)
        if yo is not None:return WordStress(word,normalized,yo,1,source="ё")
        plus=predicted.find("+")
        position=plus if plus>=0 else None
        if position is not None and position>=len(word):position=None
        variants=self.accentor.homosolver.homodict.get(normalized) or self.accentor.homosolver.yohomodict.get(normalized) or []
        alternatives=tuple(dict.fromkeys(v.find("+") for v in variants if v.find("+")>=0 and v.find("+")!=position))
        ambiguous=bool(alternatives) or position is None
        return WordStress(word,normalized,position,.65 if alternatives else (.8 if position is not None else 0),
                          alternatives=alternatives,source="model",ambiguous=ambiguous,
                          warning="Контекстный омограф: проверьте вариант" if alternatives else (None if position is not None else "Модель не вернула ударение"))

def analyse_line(text: str, provider: StressProvider) -> dict:
    words: list[WordStress] = []
    if hasattr(provider,"begin_line"):provider.begin_line(text)
    chunks, cursor = [], 0
    for match in WORD.finditer(text):
        chunks.append(text[cursor:match.start()])
        result = provider.analyse_word(match.group(), text)
        words.append(result)
        token = match.group()
        # Existing accents are immutable. Ё is explicit in Russian spelling and
        # deliberately receives no redundant backtick in NCRL exports.
        if "`" not in token and result.position is not None and result.source != "ё":
            token = token[:result.position+1] + "`" + token[result.position+1:]
        chunks.append(token); cursor = match.end()
    chunks.append(text[cursor:])
    uncertain = [asdict(w) for w in words if w.ambiguous or w.warning]
    confidences = [w.confidence for w in words]
    return {"sourceText": text, "suggestedText": "".join(chunks),
            "sourceHash": sha256(text.encode()).hexdigest(), "state": "pending",
            "confidence": min(confidences, default=1), "words": [asdict(w) for w in words],
            "uncertainWords": uncertain, "engine": provider.name,
            "engineVersion": provider.version}
