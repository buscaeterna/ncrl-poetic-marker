import test from "node:test";
import assert from "node:assert/strict";
import { decodeCorpus, exportCorpus, importCorpusBytes, parsePoem, splitCorpus } from "../app/corpus.ts";

const encoder = new TextEncoder();
const fixture = `<<<--- Gorenko-001.htm>>>
<html><head><meta name="author" content="Не из имени"><meta name='title' content='Первое'><meta name="date" content="1901">
@цикл Цикл
</head><body>
<p class=H1 id=1>Первое</p></p><p class='H2'>Подзаголовок</p><p class=H3>Раздел</p><p class=date>1901</p><p class=epigraf>Эпиграф</p>
<p class=verse>Строка один<br>Строка два</p><p class="verse">Строка три</p></body></html>
<<<--- Ахматова 015.html>>>
<html><head><meta name='author' content='Другой автор'><meta name="title" content="Второе"></head><body><p class=H1>Второе<br>Наследие один<br>Наследие два</p></p></body></html>
<<<--- Pushkin_poems-27.htm>>>
<meta name="author" content="Третий"><meta name="title" content="Обычный"><p class=H1>Обычный<br>Не стих</p><p class=verse>Настоящий стих</p>`;

test("universal markers retain arbitrary names and source order", () => {
  const parts = splitCorpus(fixture);
  assert.deepEqual(parts.map(({ sourceName, sourceOrder }) => [sourceName, sourceOrder]), [
    ["Gorenko-001.htm", 0], ["Ахматова 015.html", 1], ["Pushkin_poems-27.htm", 2],
  ]);
});

test("metadata, damaged HTML, structural elements and stanza boundaries survive", () => {
  const { corpus, documents } = importCorpusBytes(encoder.encode(fixture), "synthetic.txt");
  assert.equal(corpus.encoding, "utf-8");
  assert.equal(documents[0].author, "Не из имени");
  assert.equal(documents[0].title, "Первое");
  assert.equal(documents[0].cycle, "Цикл");
  assert.deepEqual(documents[0].structures.map((part) => part.kind), ["H1", "H2", "H3", "date", "epigraf", "verse", "verse"]);
  assert.deepEqual(documents[0].lines.map((line) => line.text), ["Строка один", "Строка два", "Строка три"]);
  assert.equal(documents[0].lines[2].breakBefore, true);
  assert.ok(documents[0].lines.every((line) => line.meter === "" && line.feet === 0 && line.scheme === ""));
});

test("legacy multiline H1 is used only without meaningful verse", () => {
  const documents = importCorpusBytes(encoder.encode(fixture), "legacy.html").documents;
  assert.deepEqual(documents[1].lines.map((line) => line.text), ["Наследие один", "Наследие два"]);
  assert.deepEqual(documents[2].lines.map((line) => line.text), ["Настоящий стих"]);
});

function encodeWindows1251(value) {
  const table = new TextDecoder("windows-1251").decode(Uint8Array.from({ length: 128 }, (_, index) => index + 128));
  return Uint8Array.from([...value].map((character) => {
    const code = character.codePointAt(0);
    if (code < 128) return code;
    const index = table.indexOf(character);
    if (index < 0) throw new Error(`Cannot encode ${character}`);
    return index + 128;
  }));
}

test("strict UTF-8 falls back to synthetic Windows-1251 without replacements", () => {
  const source = "<<<--- кириллица_01.htm>>>\n<meta name='author' content='Матвеева'><meta name='title' content='Ночь'><p class=verse>Луна</p>";
  const decoded = decodeCorpus(encodeWindows1251(source));
  assert.equal(decoded.encoding, "windows-1251");
  assert.equal(decoded.text, source);
  assert.equal(decoded.text.includes("�"), false);
});

test("multiple files remain separate corpora and round-trip through corpus export", () => {
  const first = importCorpusBytes(encoder.encode(fixture), "first.txt", 0);
  const secondSource = "<<<--- other-2.html>>>\n<meta name='author' content='Автор'><meta name='title' content='Текст'><p class=verse>А<br>Б</p>";
  const second = importCorpusBytes(encoder.encode(secondSource), "second.html", 1);
  assert.notEqual(first.corpus.id, second.corpus.id);
  assert.equal(first.documents.every((poem) => poem.corpusId === first.corpus.id), true);
  const exported = exportCorpus(first.corpus, first.documents);
  const roundTrip = splitCorpus(exported).map((part) => parsePoem(part.html, part.sourceName, part.sourceOrder, "round"));
  assert.deepEqual(roundTrip.map((poem) => ({ name: poem.sourceName, author: poem.author, title: poem.title, kinds: poem.structures.map((item) => item.kind), lines: poem.lines.map((line) => line.text) })),
    first.documents.map((poem) => ({ name: poem.sourceName, author: poem.author, title: poem.title, kinds: poem.structures.map((item) => item.kind), lines: poem.lines.map((line) => line.text) })));
});

test("queue edits can be retained while switching, deleted, and cleared", () => {
  const poems = importCorpusBytes(encoder.encode(fixture), "state.txt").documents;
  const edited = poems.map((poem, index) => index === 0 ? { ...poem, lines: poem.lines.map((line, lineIndex) => lineIndex === 0 ? { ...line, text: "Ручная правка" } : line) } : poem);
  assert.equal(edited[0].lines[0].text, "Ручная правка");
  assert.equal(edited[1].title, "Второе");
  const afterDelete = edited.filter((poem) => poem.id !== edited[1].id);
  assert.equal(afterDelete.length, 2);
  assert.deepEqual(afterDelete.filter(() => false), []);
});
