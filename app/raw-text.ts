import { decodeCorpus, parsePoem, type ImportedCorpus, type ImportedPoem, type SourceEncoding } from "./corpus.ts";

export type RawTitleKind = "heading" | "incipit";
export type RawBoundaryConfidence = "high" | "medium" | "low";

export type RawPoemDraft = {
  id: string;
  title: string;
  body: string;
  titleKind: RawTitleKind;
  confidence: RawBoundaryConfidence;
  reason: string;
};

export type RawTextImportDraft = {
  id: string;
  name: string;
  order: number;
  encoding: SourceEncoding;
  eol: "\n" | "\r\n";
  author: string;
  poems: RawPoemDraft[];
};

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");

function normalizeRawText(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function isSeparator(line: string) {
  return /^(?:={4,}|-{5,}|_{5,})$/.test(line.trim());
}

function isStrongHeading(line: string) {
  const value = line.trim();
  if (!value || value.length > 100) return false;
  if (/^#{1,6}\s+\S/.test(value) || /^(?:\*\s*){3,}$/.test(value)) return true;
  if (/^(?:[IVXLCDM]+|[А-ЯЁA-Z]|\d{1,3})[.)]?$/u.test(value)) return true;
  const letters = [...value].filter((character) => /[A-Za-zА-Яа-яЁё]/u.test(character));
  return letters.length >= 2 && letters.every((character) => character === character.toUpperCase());
}

function splitAtLargeGaps(value: string) {
  const segments: string[] = [];
  let current: string[] = [];
  let blankLines = 0;
  const finish = () => {
    const segment = current.join("\n").trim();
    if (segment) segments.push(segment);
    current = [];
  };

  for (const line of value.split("\n")) {
    if (isSeparator(line)) {
      finish();
      blankLines = 0;
      continue;
    }
    if (!line.trim()) {
      blankLines += 1;
      continue;
    }
    if (blankLines >= 2 && current.some((item) => item.trim())) finish();
    else if (blankLines === 1 && current.length) current.push("");
    current.push(line);
    blankLines = 0;
  }
  finish();
  return segments;
}

/** Split conservative, visually isolated headings without treating every stanza as a poem. */
function splitAtStrongHeadings(segment: string) {
  const lines = segment.split("\n");
  const boundaries: number[] = [0];
  for (let index = 1; index < lines.length - 1; index += 1) {
    if (lines[index - 1].trim() || lines[index + 1].trim() || !isStrongHeading(lines[index])) continue;
    const before = lines.slice(boundaries.at(-1), index).filter((line) => line.trim()).length;
    const after = lines.slice(index + 1).filter((line) => line.trim()).length;
    if (before >= 2 && after >= 2) boundaries.push(index);
  }
  return boundaries.map((start, index) => lines.slice(start, boundaries[index + 1] ?? lines.length).join("\n").trim()).filter(Boolean);
}

function cleanHeading(value: string) {
  return value.replace(/^#{1,6}\s+/, "").trim();
}

function incipitTitle(value: string) {
  const source = value.trim();
  if (/^«[\s\S]*»$/.test(source)) return source;
  const characters = [...source];
  const clipped = characters.slice(0, 72).join("");
  return `«${clipped}${characters.length > 72 ? "…" : ""}»`;
}

export function poemDraftFromText(value: string): RawPoemDraft | null {
  const normalized = normalizeRawText(value);
  if (!normalized) return null;
  const lines = normalized.split("\n");
  const nonEmptyAfterFirst = lines.slice(1).filter((line) => line.trim()).length;
  const first = lines[0].trim();
  const separatedTitle = !lines[1]?.trim() && nonEmptyAfterFirst >= 1;
  const explicitTitle = /^#{1,6}\s+/.test(first) || isStrongHeading(first);

  if ((separatedTitle || explicitTitle) && nonEmptyAfterFirst >= 1) {
    const body = lines.slice(1).join("\n").trim();
    return {
      id: makeId(), title: cleanHeading(first), body, titleKind: "heading",
      confidence: explicitTitle ? "high" : "medium",
      reason: explicitTitle ? "Выделенный заголовок" : "Короткая строка перед пустой строкой",
    };
  }

  return {
    id: makeId(), title: incipitTitle(first), body: normalized, titleKind: "incipit",
    confidence: "low", reason: "Отдельный заголовок не найден — использована первая строка",
  };
}

export function suggestRawPoems(value: string) {
  const normalized = normalizeRawText(value);
  if (!normalized) return [];
  return splitAtLargeGaps(normalized)
    .flatMap(splitAtStrongHeadings)
    .map(poemDraftFromText)
    .filter((poem): poem is RawPoemDraft => poem !== null);
}

export function createRawTextImport(bytes: ArrayBuffer | Uint8Array, name: string, order = 0): RawTextImportDraft {
  const decoded = decodeCorpus(bytes);
  return {
    id: makeId(), name, order, encoding: decoded.encoding,
    eol: decoded.text.includes("\r\n") ? "\r\n" : "\n",
    author: "", poems: suggestRawPoems(decoded.text),
  };
}

export function splitRawPoemAt(poem: RawPoemDraft, offset: number): [RawPoemDraft, RawPoemDraft] | null {
  if (offset <= 0 || offset >= poem.body.length) return null;
  const lineStart = poem.body.lastIndexOf("\n", offset - 1) + 1;
  if (lineStart <= 0) return null;
  const before = poem.body.slice(0, lineStart).trim();
  const after = poem.body.slice(lineStart).trim();
  if (!before || !after) return null;
  const second = poemDraftFromText(after);
  if (!second) return null;
  return [
    { ...poem, body: before, confidence: "high", reason: "Граница проверена вручную" },
    { ...second, confidence: "high", reason: "Граница добавлена вручную" },
  ];
}

export function mergeRawPoemWithPrevious(poems: RawPoemDraft[], index: number) {
  if (index <= 0 || index >= poems.length) return poems;
  const previous = poems[index - 1];
  const current = poems[index];
  const restoredCurrent = current.titleKind === "heading" ? `${current.title}\n\n${current.body}` : current.body;
  const merged = {
    ...previous,
    body: `${previous.body.trim()}\n\n${restoredCurrent.trim()}`,
    confidence: "high" as const,
    reason: "Граница удалена вручную",
  };
  return [...poems.slice(0, index - 1), merged, ...poems.slice(index + 1)];
}

function sourceBase(name: string) {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  return withoutExtension.normalize("NFC").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "poem";
}

function verseBlocks(body: string) {
  return normalizeRawText(body).split(/\n[ \t]*\n+/).map((stanza) => stanza.split("\n").map((line) => line.trim()).filter(Boolean)).filter((stanza) => stanza.length);
}

function rawPoemHtml(author: string, poem: RawPoemDraft) {
  const stanzas = verseBlocks(poem.body);
  const fields = [
    "@жанр стихотворение", "@цикл", "@строфика", "@гр_строфика", "@метр", "@клаузула", "@рифма",
    "@доп", "@формула", "@стопность", `@стихов ${stanzas.reduce((sum, stanza) => sum + stanza.length, 0)}`,
  ];
  const verses = stanzas.map((stanza) => `<p class=verse>${stanza.map(escapeHtml).join("<br>\n")}</p>`).join("\n");
  return [
    "<html>", "<head>", `<title>${escapeHtml([author, poem.title].filter(Boolean).join(". "))}</title>`,
    `<meta name='author' content='${escapeHtml(author)}'>`, `<meta name='title' content='${escapeHtml(poem.title)}'>`,
    "<meta name='date' content='????'>", ...fields, "</head>", "<body>",
    `<p class=H1>${escapeHtml(poem.title)}</p>`, verses, "</body>", "</html>",
  ].join("\n");
}

export function finalizeRawTextImport(draft: RawTextImportDraft): { corpus: ImportedCorpus; documents: ImportedPoem[] } {
  const corpusId = makeId();
  const corpus: ImportedCorpus = {
    id: corpusId, name: draft.name, encoding: draft.encoding, order: draft.order, eol: draft.eol,
  };
  const base = sourceBase(draft.name);
  const documents = draft.poems.filter((poem) => poem.body.trim()).map((poem, index) => {
    const sourceName = `${base}-${String(index + 1).padStart(4, "0")}.htm`;
    return { ...parsePoem(rawPoemHtml(draft.author.trim(), poem), sourceName, index, corpusId), status: "review" as const };
  });
  return { corpus, documents };
}
