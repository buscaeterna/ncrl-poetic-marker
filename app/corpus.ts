export type SourceEncoding = "utf-8" | "windows-1251";
export type ProcessingStatus = "unprocessed" | "processing" | "ready" | "review" | "error";

export type CorpusLine = {
  id: string;
  text: string;
  meter: string;
  feet: number;
  clause: "м" | "ж" | "д" | "г";
  scheme: string;
  breakBefore: boolean;
  starred: boolean;
  note: string;
};

export type StructuralElement = {
  kind: "H1" | "H2" | "H3" | "date" | "epigraf" | "verse";
  html: string;
  lines: string[];
};

export type ImportedPoem = {
  id: string;
  corpusId: string;
  sourceName: string;
  sourceOrder: number;
  author: string;
  title: string;
  date: string;
  cycle: string;
  fields: Record<string, string>;
  structures: StructuralElement[];
  originalHtml: string;
  lines: CorpusLine[];
  status: ProcessingStatus;
  dirty: boolean;
};

export type ImportedCorpus = {
  id: string;
  name: string;
  encoding: SourceEncoding;
  order: number;
};

const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const entities = (value: string) => value
  .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, "&");
const textLines = (html: string) => entities(html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, ""))
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");

/** Strict UTF-8 first; TextDecoder's fatal mode guarantees that U+FFFD is never introduced. */
export function decodeCorpus(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: SourceEncoding } {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    if (text.includes("�")) throw new TypeError("replacement character");
    return { text, encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1251", { fatal: true }).decode(input);
    if (text.includes("�")) throw new TypeError("The source cannot be decoded without replacement characters");
    return { text, encoding: "windows-1251" };
  }
}

export function splitCorpus(source: string) {
  const marker = /^<<<---\s*(.+?\.html?)\s*>>>\s*$/gim;
  const matches = [...source.matchAll(marker)];
  return matches.map((match, order) => ({
    sourceName: match[1],
    sourceOrder: order,
    html: source.slice(match.index! + match[0].length, matches[order + 1]?.index ?? source.length).trim(),
  }));
}

function metadata(html: string) {
  const result: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b([^>]*?)>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attr[1].toLowerCase()] = entities(attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    if (attrs.name) result[attrs.name.toLowerCase()] = attrs.content ?? "";
  }
  for (const match of html.matchAll(/^@([^\s]+)(?:\s+(.*))?$/gm)) result[match[1]] = (match[2] ?? "").trim();
  return result;
}

export function parsePoem(html: string, sourceName: string, sourceOrder: number, corpusId: string): ImportedPoem {
  const fields = metadata(html);
  const structures: StructuralElement[] = [];
  const elementPattern = /<p\b([^>]*\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*)>([\s\S]*?)(?=<\/p\s*>|<p\b|<\/body\s*>|$)/gi;
  for (const match of html.matchAll(elementPattern)) {
    const className = (match[2] ?? match[3] ?? match[4] ?? "").split(/\s+/)[0];
    const canonical = ({ h1: "H1", h2: "H2", h3: "H3", date: "date", epigraf: "epigraf", verse: "verse" } as const)[className.toLowerCase() as "h1"];
    if (canonical) structures.push({ kind: canonical, html: match[0], lines: textLines(match[5]) });
  }
  const verses = structures.filter((item) => item.kind === "verse" && item.lines.some(Boolean));
  const title = fields.title ?? "";
  let poetic = verses;
  if (!poetic.length) {
    const legacy = structures.find((item) => item.kind === "H1" && item.lines.length > 1 && item.lines[0].trim() === title.trim());
    if (legacy) poetic = [{ ...legacy, lines: legacy.lines.slice(1) }];
  }
  const lines = poetic.flatMap((stanza, stanzaIndex) => stanza.lines.map((text, lineIndex): CorpusLine => ({
    id: id(), text, meter: "", feet: 0, clause: "м", scheme: "",
    breakBefore: stanzaIndex > 0 && lineIndex === 0, starred: false, note: "",
  })));
  return {
    id: id(), corpusId, sourceName, sourceOrder, author: fields.author ?? "", title,
    date: fields.date ?? "????", cycle: fields["цикл"] ?? "", fields, structures, originalHtml: html,
    lines, status: "unprocessed", dirty: false,
  };
}

export function importCorpusBytes(bytes: ArrayBuffer | Uint8Array, name: string, order = 0) {
  const decoded = decodeCorpus(bytes);
  const corpus: ImportedCorpus = { id: id(), name, encoding: decoded.encoding, order };
  const documents = splitCorpus(decoded.text).map((part) => parsePoem(part.html, part.sourceName, part.sourceOrder, corpus.id));
  return { corpus, documents };
}

export function exportPoem(poem: ImportedPoem, renderedLines?: CorpusLine[]) {
  const lines = renderedLines ?? poem.lines;
  const fields = { ...poem.fields, author: poem.author, title: poem.title, date: poem.date, "цикл": poem.cycle };
  const head = Object.entries(fields).filter(([key]) => ["author", "title", "date"].includes(key))
    .map(([key, value]) => `<meta name='${esc(key)}' content='${esc(value)}'>`);
  const nkrya = Object.entries(fields).filter(([key]) => !["author", "title", "date"].includes(key))
    .map(([key, value]) => `@${key}${value ? ` ${value}` : ""}`);
  const hasOriginalVerse = poem.structures.some((item) => item.kind === "verse");
  const legacyH1 = !hasOriginalVerse && poem.structures.find((item) => item.kind === "H1" && item.lines.length > 1 && item.lines[0].trim() === poem.title.trim());
  const nonVerse = poem.structures.filter((item) => item.kind !== "verse").map((item) => item === legacyH1
    ? `<p class=H1>${[poem.title, ...lines.map((line) => line.text)].map(esc).join("<br>\n")}</p>` : item.html);
  const stanzas: CorpusLine[][] = [];
  for (const line of lines) {
    if (!stanzas.length || line.breakBefore) stanzas.push([]);
    stanzas.at(-1)!.push(line);
  }
  const verse = legacyH1 ? [] : stanzas.map((stanza) => `<p class=verse>${stanza.map((line) => {
    const annotation = line.meter ? `<#${line.meter}${line.starred ? "*" : ""}${line.feet}${line.clause}${line.scheme ? ` ${line.scheme}` : ""}>` : "";
    return `${annotation}${esc(line.text)}`;
  }).join("<br>\n")}</p>`);
  return ["<html>", "<head>", ...head, ...nkrya, "</head>", "<body>", ...nonVerse, ...verse, "</body>", "</html>"].join("\n");
}

export function exportCorpus(corpus: ImportedCorpus, poems: ImportedPoem[]) {
  return poems.filter((poem) => poem.corpusId === corpus.id).sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((poem) => `<<<--- ${poem.sourceName}>>>\n${exportPoem(poem)}`).join("\n");
}
