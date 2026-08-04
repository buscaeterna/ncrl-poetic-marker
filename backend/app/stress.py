"""Provider-neutral, lossless Russian word-stress analysis.

Providers return vowel offsets in the original token.  This adapter alone inserts
the NCRL backtick, so punctuation and whitespace can never be normalised by a model.
"""
from __future__ import annotations
from dataclasses import asdict, dataclass
from hashlib import sha256
from typing import Protocol
import re

WORD = re.compile(r"[А-Яа-яЁёІіѢѣ]+(?:-[А-Яа-яЁёІіѢѣ]+)*`?", re.UNICODE)
VOWELS = "аеёиоуыэюяАЕЁИОУЫЭЮЯѢѣ"

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

def analyse_line(text: str, provider: StressProvider) -> dict:
    words: list[WordStress] = []
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
    return {"source_text": text, "suggested_text": "".join(chunks),
            "source_hash": sha256(text.encode()).hexdigest(), "state": "pending",
            "confidence": min(confidences, default=1), "words": [asdict(w) for w in words],
            "uncertain_words": uncertain, "engine": provider.name,
            "engine_version": provider.version}
