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
  /** A machine result is review data only; exporters continue to use `text`. */
  stressSuggestion?: StressSuggestion;
  meterSuggestion?: MeterSuggestion;
};

export type MeterCandidate = { meter:string; feetOrIctuses:number; ictusPositions:number[]; anacrusis:number; ictusOmissions:number[]; weakStresses:number[]; violations:Array<Record<string,unknown>>; regular:boolean };
export type MeterSuggestion = { sourceText:string; sourceHash:string; analyzerVersion:string; syllables:Array<{index:number;text:string;start:number;end:number;wordIndex:number;stress:"stressed"|"unstressed"|"unknown"}>; words:Array<Record<string,unknown>>; accentSequence:string; candidates:MeterCandidate[]; selected:MeterCandidate|null; clause:"м"|"ж"|"д"|"г"|null; unknownWords:Array<Record<string,unknown>>; explanation:string; quality:"exact"|"probable"|"ambiguous"|"insufficient"; state:"pending"|"accepted"|"rejected"|"stale"; analysedAt:string; warnings:string[] };

export type StressWord = {
  original: string; normalized: string; position: number | null; confidence: number;
  alternatives: number[]; ambiguous: boolean;
  source: "model" | "dictionary" | "rule" | "ё" | "existing";
  warning?: string;
};

export type StressSuggestion = {
  sourceText: string; suggestedText: string; sourceHash: string;
  state: "pending" | "accepted" | "rejected" | "stale";
  confidence: number; uncertainWords: StressWord[]; words: StressWord[];
  engine: string; engineVersion: string; analysedAt: string;
  acceptedWords?: Array<number | { wordIndex: number; position: number }>;
};

export function effectiveLineText(line: CorpusLine) { return line.text; }

/** Accept only a result made for the current text. Existing/imported accents win. */
export function sha256Text(value: string): string {
  const bytes=new TextEncoder().encode(value), input=[...bytes];const bitLength=input.length*8;
  input.push(128);while(input.length%64!==56)input.push(0);for(let shift=56;shift>=0;shift-=8)input.push(Math.floor(bitLength/2**shift)&255);
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],primes:number[]=[];
  for(let n=2;primes.length<64;n++)if(!primes.some(p=>n%p===0))primes.push(n);const k=primes.map(p=>Math.floor((Math.cbrt(p)%1)*2**32)>>>0),rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<input.length;offset+=64){const w=Array<number>(64);for(let i=0;i<16;i++)w[i]=(input[offset+i*4]<<24)|(input[offset+i*4+1]<<16)|(input[offset+i*4+2]<<8)|input[offset+i*4+3];for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(b,17)^rotr(b,19)^(b>>>10)))>>>0}let [a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const t1=(z+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}const v=[a,b,c,d,e,f,g,z];for(let i=0;i<8;i++)h[i]=(h[i]+v[i])>>>0}
  return h.map(x=>x.toString(16).padStart(8,"0")).join("");
}

const acceptedChoices=(suggestion:StressSuggestion)=>(suggestion.acceptedWords??[]).map(value=>typeof value==="number"?{wordIndex:value,position:suggestion.words[value]?.position??-1}:value);
const applyChoice=(text:string,wordIndex:number,position:number)=>{const match=[...text.matchAll(stressToken)][wordIndex];if(!match||match[0].includes("`")||position<0||position>=match[0].length)return null;const token=match[0].slice(0,position+1)+"`"+match[0].slice(position+1);return text.slice(0,match.index)+token+text.slice(match.index!+match[0].length)};
/** Verifies both the immutable analysis input and every explicitly accepted word. */
export function stressSuggestionIsCurrent(line:CorpusLine):boolean {const s=line.stressSuggestion;if(!s||s.state==="stale"||sha256Text(s.sourceText)!==s.sourceHash)return false;let expected=s.sourceText;for(const choice of acceptedChoices(s)){const next=applyChoice(expected,choice.wordIndex,choice.position);if(next===null)return false;expected=next}return expected===line.text}

export function acceptStressSuggestion(line: CorpusLine): CorpusLine {
  const suggestion = line.stressSuggestion;
  if (!suggestion || !stressSuggestionIsCurrent(line)) return line;
  const proposed=[...suggestion.suggestedText.matchAll(stressToken)];let index=0;
  const text=line.text.replace(stressToken,(token)=>{const candidate=proposed[index++]?.[0];return token.includes("`")?token:(candidate??token)});
  return { ...line, text, stressSuggestion: { ...suggestion, state: "accepted" } };
}

const stressToken = /[А-Яа-яЁёІіѢѣ](?:[А-Яа-яЁёІіѢѣ]|(?<=[аеёиоуыэюяАЕЁИОУЫЭЮЯѢѣ])`)*(?:-[А-Яа-яЁёІіѢѣ](?:[А-Яа-яЁёІіѢѣ]|(?<=[аеёиоуыэюяАЕЁИОУЫЭЮЯѢѣ])`)*)*/gu;
export function acceptStressWord(line: CorpusLine, wordIndex: number, position?: number): CorpusLine {
  const suggestion=line.stressSuggestion;
  if(!suggestion||!stressSuggestionIsCurrent(line)||acceptedChoices(suggestion).some(value=>value.wordIndex===wordIndex))return line;
  const matches=[...line.text.matchAll(stressToken)], word=suggestion.words[wordIndex], match=matches[wordIndex];
  if(!word||!match||match[0].includes("`"))return line;
  const chosen=position??word.position;
  if(chosen===null||chosen<0||chosen>=match[0].length)return line;
  const token=match[0].slice(0,chosen+1)+"`"+match[0].slice(chosen+1);
  const text=line.text.slice(0,match.index)+token+line.text.slice(match.index!+match[0].length);
  return {...line,text,stressSuggestion:{...suggestion,acceptedWords:[...acceptedChoices(suggestion),{wordIndex,position:chosen}]}};
}

export function editLineText(line: CorpusLine, text: string): CorpusLine {
  const suggestion = line.stressSuggestion;
  const meterSuggestion=line.meterSuggestion;
  return { ...line, text, stressSuggestion: suggestion && suggestion.sourceText !== text
    ? { ...suggestion, state: "stale" } : suggestion, meterSuggestion: meterSuggestion && meterSuggestion.sourceText !== text ? {...meterSuggestion,state:"stale"} : meterSuggestion };
}

/** Explicit application; a suggestion never affects export while pending. */
export function acceptMeterSuggestion(line:CorpusLine,candidate=line.meterSuggestion?.selected):CorpusLine {
  const suggestion=line.meterSuggestion;
  if(!suggestion||!candidate||suggestion.state==="stale"||suggestion.sourceHash!==sha256Text(line.text))return line;
  return {...line,meter:candidate.meter,feet:candidate.feetOrIctuses,clause:suggestion.clause??line.clause,
    scheme:suggestion.accentSequence,meterSuggestion:{...suggestion,selected:candidate,state:"accepted"}};
}
export function rejectMeterSuggestion(line:CorpusLine):CorpusLine {return line.meterSuggestion?{...line,meterSuggestion:{...line.meterSuggestion,state:"rejected"}}:line}

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
  /** True after the imported content itself has been edited (unlike `dirty`, this survives autosave). */
  modified: boolean;
  /** Editor-only metadata state is persisted in IndexedDB between selections. */
  editorMetadata?: import("./editor-metadata").EditorMetadata;
  /** Raw text has no authoritative imported annotation, even though its generated HTML has empty fields. */
  rawText?: boolean;
  /** Import provenance is editor state and is deliberately omitted from HTML export. */
  provenance?: {sourceDocumentId:string;sourcePdfName:string;pageRange:string;usedOcr:boolean;confirmedAt:string};
};

export type ImportedCorpus = {
  id: string;
  name: string;
  encoding: SourceEncoding;
  order: number;
  eol: "\n" | "\r\n";
  /** Exact decoded source permits a byte-for-byte no-op export. */
  originalSource?: string;
  /** Ordered identity of the documents captured with originalSource. Absent on legacy IndexedDB records. */
  originalDocuments?: Array<{ sourceName: string; sourceOrder: number }>;
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
  // Deliberately exclude newlines: every NKRЯ field is one physical line, including empty fields.
  for (const match of html.matchAll(/^@([^\s]+)(?:[ \t]+([^\r\n]*))?[ \t]*\r?$/gm)) result[match[1]] = (match[2] ?? "").trim();
  return result;
}

export function parsePoem(html: string, sourceName: string, sourceOrder: number, corpusId: string): ImportedPoem {
  const fields = metadata(html);
  const structures: StructuralElement[] = [];
  const elementPattern = /<p\b([^>]*\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*)>([\s\S]*?)(?:<\/p\s*>|(?=<p\b|<\/body\s*>|$))/gi;
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
    lines, status: "unprocessed", dirty: false, modified: false,
  };
}

export function importCorpusBytes(bytes: ArrayBuffer | Uint8Array, name: string, order = 0) {
  const decoded = decodeCorpus(bytes);
  const parts = splitCorpus(decoded.text);
  const corpus: ImportedCorpus = {
    id: id(), name, encoding: decoded.encoding, order,
    eol: decoded.text.includes("\r\n") ? "\r\n" : "\n", originalSource: decoded.text,
    originalDocuments: parts.map(({ sourceName, sourceOrder }) => ({ sourceName, sourceOrder })),
  };
  const documents = parts.map((part) => parsePoem(part.html, part.sourceName, part.sourceOrder, corpus.id));
  return { corpus, documents };
}

export function exportPoem(poem: ImportedPoem, renderedLines?: CorpusLine[]) {
  if (!poem.modified) return poem.originalHtml;
  const lines = renderedLines ?? poem.lines;
  const fields = { ...poem.fields, author: poem.author, title: poem.title, date: poem.date, "цикл": poem.cycle };
  const head = Object.entries(fields).filter(([key]) => ["author", "title", "date"].includes(key))
    .map(([key, value]) => `<meta name='${esc(key)}' content='${esc(value)}'>`);
  const authorTitle = poem.author.replace(/^(.+?)\s+((?:[А-ЯЁA-Z]\.?\s*){1,3})$/u, (_all, surname, initials) => `${initials.replace(/\s/g, "")} ${surname}`);
  head.unshift(`<title>${esc([authorTitle, poem.title].filter(Boolean).join(". "))}</title>`);
  const nkrya = Object.entries(fields).filter(([key]) => !["author", "title", "date"].includes(key))
    .map(([key, value]) => `@${key}${value ? ` ${value}` : ""}`);
  const hasOriginalVerse = poem.structures.some((item) => item.kind === "verse");
  const legacyH1 = !hasOriginalVerse && poem.structures.find((item) => item.kind === "H1" && item.lines.length > 1 && item.lines[0].trim() === poem.title.trim());
  const stanzas: CorpusLine[][] = [];
  for (const line of lines) {
    if (!stanzas.length || line.breakBefore) stanzas.push([]);
    stanzas.at(-1)!.push(line);
  }
  const renderLines = (stanza: CorpusLine[]) => stanza.map((line) => {
    const annotation = line.meter ? `<#${line.meter}${line.starred ? "*" : ""}${line.feet}${line.clause}${line.scheme ? ` ${line.scheme}` : ""}>` : "";
    return `${annotation}${esc(line.text)}`;
  }).join("<br>\n");

  let stanzaIndex = 0;
  let sawVerse = false;
  const structuralPattern = /<p\b([^>]*\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*)>[\s\S]*?(?:<\/p\s*>|(?=<p\b|<\/body\s*>|$))/gi;
  let body = poem.originalHtml.replace(structuralPattern, (original, attrs, doubleClass, singleClass, bareClass) => {
    const kind = (doubleClass ?? singleClass ?? bareClass ?? "").split(/\s+/)[0].toLowerCase();
    const opening = `<p${attrs}>`;
    if (kind === "verse") {
      sawVerse = true;
      const stanza = stanzas[stanzaIndex++] ?? [];
      const extra = stanzaIndex === poem.structures.filter((item) => item.kind === "verse").length
        ? stanzas.slice(stanzaIndex).map((item) => `\n${opening}${renderLines(item)}</p>`).join("") : "";
      if (extra) stanzaIndex = stanzas.length;
      return `${opening}${renderLines(stanza)}</p>${extra}`;
    }
    if (legacyH1 && kind === "h1") return `${opening}${[poem.title, ...lines.map((line) => line.text)].map(esc).join("<br>\n")}</p>`;
    return /<\/p\s*>$/i.test(original) ? original : `${original}</p>`;
  });
  if (!legacyH1 && !sawVerse && stanzas.length) {
    const verses = stanzas.map((stanza) => `<p class=verse>${renderLines(stanza)}</p>`).join("\n");
    body = /<\/body\s*>/i.test(body) ? body.replace(/<\/body\s*>/i, `${verses}\n</body>`) : `${body}\n${verses}`;
  }

  const newHead = `<head>\n${[...head, ...nkrya].join("\n")}\n</head>`;
  const placeholder = "__NCRL_HEAD_PLACEHOLDER__";
  const hadHead = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i.test(body);
  body = body.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, placeholder).replace(/<\/?head\b[^>]*>/gi, "");
  if (hadHead) body = body.replace(placeholder, newHead).replaceAll(placeholder, "");
  else if (/<html\b[^>]*>/i.test(body)) body = body.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n${newHead}`);
  else body = `${newHead}\n${body}`;
  return body;
}

export function exportCorpus(corpus: ImportedCorpus, poems: ImportedPoem[]) {
  const corpusPoems = poems.filter((poem) => poem.corpusId === corpus.id);
  const sameDocuments = corpus.originalDocuments !== undefined
    && corpusPoems.length === corpus.originalDocuments.length
    && corpusPoems.every((poem, index) => poem.sourceName === corpus.originalDocuments![index].sourceName
      && poem.sourceOrder === corpus.originalDocuments![index].sourceOrder);
  if (corpus.originalSource !== undefined && sameDocuments && corpusPoems.every((poem) => !poem.modified)) return corpus.originalSource;
  const eol = corpus.eol ?? "\n";
  return corpusPoems.sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((poem) => `<<<--- ${poem.sourceName}>>>${eol}${exportPoem(poem).replace(/\r?\n/g, eol)}`).join(eol);
}

export function encodeCorpus(value: string, encoding: SourceEncoding): Uint8Array<ArrayBuffer> {
  if (encoding === "utf-8") return new TextEncoder().encode(value);
  const highBytes = Uint8Array.from({ length: 128 }, (_, index) => index + 128);
  const table = new TextDecoder("windows-1251").decode(highBytes);
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 128) bytes.push(code);
    else {
      const index = table.indexOf(character);
      if (index < 0) throw new Error(`Символ «${character}» нельзя сохранить в Windows-1251. Экспортируйте корпус в UTF-8.`);
      bytes.push(index + 128);
    }
  }
  return Uint8Array.from(bytes);
}

export function exportCorpusBytes(corpus: ImportedCorpus, poems: ImportedPoem[]) {
  return encodeCorpus(exportCorpus(corpus, poems), corpus.encoding);
}
