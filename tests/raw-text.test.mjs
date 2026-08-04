import test from "node:test";
import assert from "node:assert/strict";
import { exportCorpus, splitCorpus } from "../app/corpus.ts";
import { createRawTextImport, finalizeRawTextImport, mergeRawPoemWithPrevious, splitRawPoemAt, suggestRawPoems } from "../app/raw-text.ts";

const encoder = new TextEncoder();

const raw = `ПЕРВОЕ

Первая строка
Вторая строка

Третья строка
Четвёртая строка


Второе стихотворение

Снова первая
Снова вторая`;

test("raw text is conservatively split into titled poems while single blank lines retain stanzas", () => {
  const poems = suggestRawPoems(raw);
  assert.equal(poems.length, 2);
  assert.deepEqual(poems.map((poem) => poem.title), ["ПЕРВОЕ", "Второе стихотворение"]);
  assert.match(poems[0].body, /Вторая строка\n\nТретья строка/);
  assert.equal(poems[0].confidence, "high");
  assert.equal(poems[1].confidence, "medium");
});

test("untitled text keeps its first verse line and receives an incipit title", () => {
  const poems = suggestRawPoems("Я вышел ночью\nИ увидел свет");
  assert.equal(poems.length, 1);
  assert.equal(poems[0].title, "«Я вышел ночью»");
  assert.equal(poems[0].body, "Я вышел ночью\nИ увидел свет");
  assert.equal(poems[0].titleKind, "incipit");
});

test("a reviewer can add and remove a poem boundary without losing text lines", () => {
  const poem = suggestRawPoems("Первая\nВторая\nНОВОЕ\n\nТретья\nЧетвёртая")[0];
  const split = splitRawPoemAt(poem, poem.body.indexOf("НОВОЕ"));
  assert.ok(split);
  assert.equal(split[1].title, "НОВОЕ");
  assert.equal(split[1].body, "Третья\nЧетвёртая");
  const merged = mergeRawPoemWithPrevious(split, 1);
  for (const line of ["Первая", "Вторая", "НОВОЕ", "Третья", "Четвёртая"]) assert.match(merged[0].body, new RegExp(line));
});

test("confirmed raw drafts become a review corpus with neutral generated names and empty metrical markup", () => {
  const draft = createRawTextImport(encoder.encode(raw), "matveeva selection.txt", 3);
  draft.author = "Н. Матвеева";
  const { corpus, documents } = finalizeRawTextImport(draft);
  assert.equal(corpus.name, "matveeva selection.txt");
  assert.equal(corpus.order, 3);
  assert.deepEqual(documents.map((poem) => poem.sourceName), ["matveeva_selection-0001.htm", "matveeva_selection-0002.htm"]);
  assert.ok(documents.every((poem) => poem.author === "Н. Матвеева" && poem.status === "review"));
  assert.ok(documents.every((poem) => poem.lines.every((line) => line.meter === "" && line.feet === 0 && line.scheme === "")));
  assert.equal(documents[0].lines[2].breakBefore, true);

  const exported = exportCorpus(corpus, documents);
  assert.equal(splitCorpus(exported).length, 2);
  assert.match(exported, /<meta name='author' content='Н\. Матвеева'>/);
  assert.match(exported, /@стихов 4/);
});
