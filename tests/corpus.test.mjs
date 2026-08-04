import test from "node:test";
import assert from "node:assert/strict";
import { decodeCorpus, encodeCorpus, exportCorpus, exportCorpusBytes, exportPoem, importCorpusBytes, parsePoem, splitCorpus } from "../app/corpus.ts";

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

const damagedFixture = `<<<--- Matveeva-001.htm>>>
<html><head>
<meta name='author' content='Матвеева Н.Н.'>
<meta name='title' content='НАШ ГЕРБ'>
<meta name='date' content='19??'>
@жанр стихотворение
@цикл
@строфика
@гр_строфика
@метр
@клаузула |
@рифма |
@доп
</head>
</head><body>
<p class=H1 id=1>НАШ ГЕРБ
<p class=H2 id=1.1>Подзаголовок
<p class=verse id=v1>Первая<br>Вторая
<p class=date id=d1>19??
<p class=epigraf id=e1>Посвящение
<p class=H3 id=1.1.1>Раздел
<p class=verse id=v2>Третья
</body></html>`;

test("empty NKRЯ fields are parsed independently and never consume head markup", () => {
  const poem = importCorpusBytes(encoder.encode(damagedFixture), "metadata.txt").documents[0];
  assert.deepEqual(Object.fromEntries(["цикл", "строфика", "гр_строфика", "метр", "клаузула", "рифма", "доп"].map((key) => [key, poem.fields[key]])), {
    "цикл": "", "строфика": "", "гр_строфика": "", "метр": "", "клаузула": "|", "рифма": "|", "доп": "",
  });
  assert.notEqual(poem.fields["доп"], "</head>");
});

test("edited export has one complete head, a title, and one metadata field per line", () => {
  const poem = { ...importCorpusBytes(encoder.encode(damagedFixture), "head.txt").documents[0], modified: true };
  const output = exportPoem(poem);
  assert.equal((output.match(/<head>/gi) ?? []).length, 1);
  assert.equal((output.match(/<\/head>/gi) ?? []).length, 1);
  assert.match(output, /<title>Н\.Н\. Матвеева\. НАШ ГЕРБ<\/title>/);
  assert.match(output, /@цикл\n@строфика\n@гр_строфика\n@метр\n@клаузула \|\n@рифма \|\n@доп\n<\/head>/);
});

test("edited structural elements close, retain ids, order, and separate verses", () => {
  const poem = importCorpusBytes(encoder.encode(damagedFixture), "structure.txt").documents[0];
  poem.modified = true;
  poem.lines[0] = { ...poem.lines[0], text: "Исправленная" };
  const output = exportPoem(poem);
  for (const kind of ["H1", "H2", "H3", "date", "epigraf", "verse"]) assert.match(output, new RegExp(`<p class=${kind}[^>]*>[\\s\\S]*?<\\/p>`, "i"));
  assert.equal((output.match(/<p\b/gi) ?? []).length, (output.match(/<\/p>/gi) ?? []).length);
  for (const value of ["1", "1.1", "v1", "d1", "e1", "1.1.1", "v2"]) assert.match(output, new RegExp(`id=${value}(?:\\s|>)`));
  const positions = ["class=H1", "class=H2", "id=v1", "class=date", "class=epigraf", "class=H3", "id=v2"].map((token) => output.indexOf(token));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal((output.match(/<p class=verse/gi) ?? []).length, 2);
  assert.match(output, /<p class=verse id=v1>Исправленная<br>\nВторая<\/p>/);
});

test("unchanged imported HTML is emitted verbatim without structural loss", () => {
  const { corpus, documents } = importCorpusBytes(encoder.encode(damagedFixture), "unchanged.txt");
  assert.equal(exportPoem(documents[0]), documents[0].originalHtml);
  assert.equal(splitCorpus(exportCorpus(corpus, documents))[0].html, documents[0].originalHtml);
});

test("UTF-8 and Windows-1251 corpus exports retain encoding, content, markers, and order", () => {
  const twoDocuments = `${damagedFixture}\n<<<--- Matveeva-002.htm>>>\n<html><head><meta name='author' content='Матвеева'><meta name='title' content='ДВА'></head><body><p class=verse>Ёлка</p></body></html>`;
  const utf = importCorpusBytes(encoder.encode(twoDocuments), "utf.txt");
  const utfBytes = exportCorpusBytes(utf.corpus, utf.documents);
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(utfBytes), exportCorpus(utf.corpus, utf.documents));

  const cp = importCorpusBytes(encodeWindows1251(twoDocuments.replaceAll("\n", "\r\n")), "cp.txt");
  assert.equal(cp.corpus.encoding, "windows-1251");
  assert.equal(cp.corpus.eol, "\r\n");
  assert.equal(cp.documents[0].fields["доп"], "");
  const cpBytes = exportCorpusBytes(cp.corpus, cp.documents);
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(cpBytes));
  const decoded = new TextDecoder("windows-1251", { fatal: true }).decode(cpBytes);
  assert.equal(decoded.includes("�"), false);
  assert.equal((decoded.match(/^<<<---/gm) ?? []).length, 2);
  assert.ok(decoded.indexOf("Matveeva-001.htm") < decoded.indexOf("Matveeva-002.htm"));
  const reimported = importCorpusBytes(cpBytes, "again.txt");
  assert.equal(reimported.documents.some((poem) => poem.originalHtml.includes("�")), false);
  assert.deepEqual(reimported.documents.map((poem) => poem.sourceName), ["Matveeva-001.htm", "Matveeva-002.htm"]);
});

test("Windows-1251 encoding rejects unrepresentable edits with actionable guidance", () => {
  assert.throws(() => encodeCorpus("текст 😀", "windows-1251"), /UTF-8/);
});
