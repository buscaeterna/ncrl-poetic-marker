"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { decodeCorpus, encodeCorpus, exportCorpusBytes, exportPoem, importCorpusBytes, splitCorpus, type ImportedCorpus, type ImportedPoem, type ProcessingStatus } from "./corpus";
import { loadWorkspace, saveWorkspace } from "./corpus-db";
import { RawImportDialog } from "./raw-import-dialog";
import { createRawTextImport, finalizeRawTextImport, type RawTextImportDraft } from "./raw-text";

type Clause = "м" | "ж" | "д" | "г";
type Meter = "" | "Я" | "Х" | "Д" | "Ан" | "Аф" | "Дк" | "Тк" | "Ак" | "О";

type VerseLine = {
  id: string;
  text: string;
  meter: Meter;
  feet: number;
  clause: Clause;
  scheme: string;
  breakBefore: boolean;
  starred: boolean;
  note: string;
};

type DocumentState = {
  author: string;
  title: string;
  date: string;
  cycle: string;
  strophe: string;
  graphicStrophe: string;
  rhyme: string;
  rhymeScheme: string;
  mode: "auto" | "heterometry" | "polymetry" | "free";
  effects: string[];
  lines: VerseLine[];
};

type Issue = { level: "error" | "warning" | "info"; title: string; detail: string; line?: number };

const VOWELS = "аеёиоуыэюяАЕЁИОУЫЭЮЯ";
const METERS: Meter[] = ["", "Я", "Х", "Д", "Аф", "Ан", "Дк", "Тк", "Ак", "О"];
const EFFECTS = [
  "переменная анакруса",
  "урегулированная анакруса",
  "нарушения анакрусы",
  "сверхдлинная анакруса",
  "перебои",
  "цезурные наращения",
  "цезурные усечения",
  "нарушения строфики",
  "полиметрия",
  "тавторифма",
  "холостая строка",
];
const ST_ORDER: Meter[] = ["Ан", "Аф", "Д", "Х", "Я"];
const ALL_ORDER: Meter[] = ["Ан", "Аф", "Д", "Х", "Я", "О", "Дк", "Тк", "Ак"];

const uid = () => Math.random().toString(36).slice(2, 10);

const sample: DocumentState = {
  author: "А. Горенко",
  title: "«За шесть или семь или восемь сытых погодой лет...»",
  date: "????",
  cycle: "",
  strophe: "0",
  graphicStrophe: "",
  rhyme: "спорадическая",
  rhymeScheme: "",
  mode: "auto",
  effects: ["переменная анакруса"],
  lines: [
    ["За ше`сть или се`мь или во`семь сы`тых пого`дой ¦ле`т", "Дк", 6, "м", "1*2*2*1*2*1*0"],
    ["Метро` и кино` успе`ли сли`ться в ¦одно`", "Дк", 5, "м", "1*2*1*1*2*0"],
    ["Разноцве`тное` развлече`ние` для ¦цветны`х", "Дк", 5, "м", "2*1*2*1*2*0"],
    ["(дво`е и`ли трои`х) — но его` нельзя` раздели`ть как сказа`л ¦поэ`т", "Дк", 8, "м", "0*1*2*2*1*2*2*1*0"],
    ["да и ри`фмы присто`йной ¦не`т", "Дк", 3, "м", "2*2*1*0"],
    ["мы` говори`м матема`тикой — ка`к бы ¦солга`ть?", "Д", 5, "м", "0*2*2*2*2*0"],
    ["Ря`бь темноты` возьме`тся ли на`м ¦помога`ть", "Дк", 5, "м", "0*2*1*2*2*0"],
    ["спра`ва ли, сле`ва пове`рю ли в го`род ¦родно`й", "Д", 5, "м", "0*2*2*2*2*0"],
    ["И сия`ет асфа`льт но я зна`ю покры`тый ¦слюно`й", "Ан", 5, "м", "2*2*2*2*2*0"],
    ["Ви`дно вре`мя моё` ¦истекло`", "Дк", 4, "м", "0*1*2*2*0"],
  ].map(([text, meter, feet, clause, scheme]) => ({
    id: uid(), text: String(text), meter: meter as Meter, feet: Number(feet), clause: clause as Clause,
    scheme: String(scheme), breakBefore: false, starred: false, note: "",
  })),
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countSyllables(text: string) {
  return [...text].filter((char) => VOWELS.includes(char)).length;
}

function stressedSyllables(text: string) {
  let syllable = 0;
  const result: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (VOWELS.includes(text[i])) {
      syllable += 1;
      if (text[i + 1] === "`") result.push(syllable);
    }
  }
  return result;
}

function suggestMeter(text: string): { meter: Meter; feet: number; scheme: string; note: string } {
  const syllables = countSyllables(text);
  const stresses = stressedSyllables(text);
  if (!syllables) return { meter: "", feet: 1, scheme: "", note: "Нет слогов" };
  if (syllables === 1) return { meter: "О", feet: 1, scheme: "0", note: "Односложная строка" };
  if (!stresses.length) {
    return { meter: "", feet: Math.max(1, Math.round(syllables / 2)), scheme: "", note: "Расставьте словесные ударения" };
  }
  const patterns: { meter: Meter; first: number; step: number }[] = [
    { meter: "Я", first: 2, step: 2 }, { meter: "Х", first: 1, step: 2 },
    { meter: "Д", first: 1, step: 3 }, { meter: "Аф", first: 2, step: 3 }, { meter: "Ан", first: 3, step: 3 },
  ];
  let best = patterns[0];
  let bestScore = Infinity;
  for (const pattern of patterns) {
    const score = stresses.reduce((sum, stress) => sum + Math.min(...Array.from({ length: 12 }, (_, i) => Math.abs(stress - (pattern.first + i * pattern.step)))), 0);
    if (score < bestScore) { best = pattern; bestScore = score; }
  }
  const feet = Math.max(1, Math.floor((syllables - best.first) / best.step) + 1);
  return {
    meter: best.meter,
    feet,
    scheme: Array.from({ length: feet }, () => String(best.step - 1)).join("*"),
    note: bestScore ? "Предварительная схема: проверьте иктусы" : "Схема совпадает с отмеченными ударениями",
  };
}

function groupByParts(lines: VerseLine[]) {
  const parts: VerseLine[][] = [];
  for (const line of lines) {
    if (!parts.length || line.breakBefore) parts.push([]);
    parts[parts.length - 1].push(line);
  }
  return parts;
}

function meterFor(lines: VerseLine[], mode: DocumentState["mode"]) {
  if (mode === "free") {
    const st = ST_ORDER.filter((meter) => lines.some((line) => line.meter === meter));
    return `${st.length ? `${st.join(", ")}, ` : ""}тонический | Вл`;
  }
  const actual = ALL_ORDER.filter((meter) => lines.some((line) => line.meter === meter));
  const st = ST_ORDER.filter((meter) => actual.includes(meter));
  const counts = (meter: Meter) => lines.filter((line) => line.meter === meter).length;
  let tonic = "";
  if (actual.includes("Ак")) tonic = "Ак";
  else if (actual.includes("Тк")) tonic = actual.includes("Дк") && counts("Дк") > counts("Тк") ? "Дк, Тк" : "Тк";
  else if (actual.includes("Дк")) tonic = "Дк";
  const body = [st.join(", "), tonic ? `тонический | ${tonic}` : "", actual.includes("О") ? "О" : ""].filter(Boolean).join(", ");
  return mode === "heterometry" ? `гетерометрия | ${actual.filter((x) => !["Дк", "Тк", "Ак", "О"].includes(x)).join(", ")}` : body;
}

function compactFormula(lines: VerseLine[], free = false) {
  const groups = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!line.meter) continue;
    const meter = free ? "Вл" : line.meter;
    const key = `${meter}|${line.clause}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(line.feet);
  }
  const meterCounts = new Map<string, number>();
  lines.forEach((line) => {
    const meter = free ? "Вл" : line.meter;
    if (meter) meterCounts.set(meter, (meterCounts.get(meter) ?? 0) + 1);
  });
  const chunks = [...groups.entries()]
    .sort(([a], [b]) => ALL_ORDER.indexOf(a.split("|")[0] as Meter) - ALL_ORDER.indexOf(b.split("|")[0] as Meter))
    .map(([key, feet]) => {
      const [meter, clause] = key.split("|");
      return { meter, text: `${meter}${[...feet].sort((a, b) => a - b).join(",")}${clause}` };
    });
  const dominant = [...meterCounts].sort((a, b) => b[1] - a[1])[0];
  if (!free && dominant && dominant[1] / lines.length > .5 && meterCounts.size > 1) {
    const main = chunks.filter((chunk) => chunk.meter === dominant[0]).map((chunk) => chunk.text);
    const rare = chunks.filter((chunk) => chunk.meter !== dominant[0]).map((chunk) => chunk.text);
    return `${main.join(", ")}; ${rare.join(", ")}`;
  }
  return chunks.map((chunk) => chunk.text).join(", ");
}

function stopnessFor(lines: VerseLine[]) {
  const feet = [...new Set(lines.filter((line) => line.meter).map((line) => line.feet))].sort((a, b) => a - b);
  if (!feet.length) return "";
  if (feet.length === 1) return String(feet[0]);
  const counts = new Map<number, number>();
  lines.forEach((line) => counts.set(line.feet, (counts.get(line.feet) ?? 0) + 1));
  const [main, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (count / lines.length >= .75) return `${main}(${feet.filter((x) => x !== main).join(",")})`;
  return `вольная | ${feet.join(",")}`;
}

function clauseFor(lines: VerseLine[]) {
  const clauses = [...new Set(lines.map((line) => line.clause))];
  if (clauses.length === 1) return clauses[0];
  return `вольная | ${["д", "ж", "м", "г"].filter((x) => clauses.includes(x as Clause)).join(", ")}`;
}

function deriveMetadata(doc: DocumentState) {
  const parts = groupByParts(doc.lines);
  const polymetric = doc.mode === "polymetry";
  const meter = polymetric
    ? `полиметрия | ${parts.map((part) => meterFor(part, "auto")).join(" # ")} несоизмеримые`
    : meterFor(doc.lines, doc.mode);
  const formula = polymetric
    ? parts.map((part) => compactFormula(part)).join(" # ")
    : compactFormula(doc.lines, doc.mode === "free");
  const stopness = polymetric
    ? `${parts.map(stopnessFor).join(" # ")} несоизмеримые`
    : stopnessFor(doc.lines);
  const clausula = polymetric ? parts.map(clauseFor).join(" # ") : clauseFor(doc.lines);
  const rhyme = doc.rhymeScheme ? `${doc.rhyme} | ${doc.rhymeScheme}` : doc.rhyme;
  const effects = [...doc.effects];
  if (polymetric && !effects.includes("полиметрия")) effects.push("полиметрия");
  return { meter, formula, stopness, clausula, rhyme, effects };
}

function validate(doc: DocumentState, meta: ReturnType<typeof deriveMetadata>): Issue[] {
  const issues: Issue[] = [];
  if (!doc.lines.length) issues.push({ level: "error", title: "Нет стиховых строк", detail: "Добавьте или импортируйте текст." });
  doc.lines.forEach((line, index) => {
    if (!line.meter) issues.push({ level: "error", title: "Не указан метр строки", detail: "Выберите метр после проверки словесных ударений.", line: index + 1 });
    if (!line.feet) issues.push({ level: "error", title: "Не указана стопность", detail: "Стопность обязательна для каждой строки.", line: index + 1 });
    if (!line.text.includes("`")) issues.push({ level: "warning", title: "Нет знаков ударения", detail: "Проверьте все словоформы и отметьте ударные гласные.", line: index + 1 });
    if (line.meter === "Ак") issues.push({ level: "warning", title: "Строка Ак требует пересмотра", detail: "Проверьте, можно ли восстановить икт и представить строку как Дк или Тк.", line: index + 1 });
    if (line.meter === "О" && countSyllables(line.text) > 1) issues.push({ level: "error", title: "Сомнительный односложный метр", detail: "О применяется к действительно односложной строке; проверьте Я1 или Х1.", line: index + 1 });
  });
  if (!meta.stopness) issues.push({ level: "error", title: "Пустая графа стопности", detail: "@стопность нужно заполнять всегда." });
  if (meta.formula.includes("Тк") && !meta.meter.includes("Тк")) issues.push({ level: "error", title: "Тк отсутствует в @метр", detail: "Если Тк присутствует в строках или формуле, укажите его в графе метра." });
  if (doc.mode === "free" && doc.rhyme !== "0") issues.push({ level: "error", title: "Вл должен быть нерифмованным", detail: "По инструкции Вл — свободный нерифмованный тонический стих." });
  if (doc.mode === "free" && doc.effects.includes("нарушения строфики")) issues.push({ level: "error", title: "У Вл нет нарушений строфики", detail: "Регулярная строфика отсутствует, поэтому нарушать её невозможно." });
  if (doc.mode === "heterometry" && doc.effects.some((x) => x.includes("анакрус"))) issues.push({ level: "error", title: "Лишняя помета анакрусы", detail: "При гетерометрии переменная анакруса уже включена в термин." });
  if (doc.strophe === "0" && doc.graphicStrophe === "0") issues.push({ level: "error", title: "Дублирование нулевой строфики", detail: "При @строфика 0 пустую @гр_строфика оставляют без значения, если пробельных делений нет." });
  if (doc.strophe !== "0" && !doc.graphicStrophe) issues.push({ level: "warning", title: "Не описана графическая строфика", detail: "Если пробельных строк нет, укажите @гр_строфика 0." });
  if (doc.mode === "polymetry" && groupByParts(doc.lines).length < 2) issues.push({ level: "error", title: "Нет частей полиметрии", detail: "Отметьте начало второй метрически самостоятельной части." });
  if (meta.formula.includes("~") && !doc.effects.some((x) => x.startsWith("цезурные"))) issues.push({ level: "error", title: "Не указан цезурный эффект", detail: "Цезурный эффект должен быть отражён в @формула и @доп." });
  if (!issues.length) issues.push({ level: "info", title: "Формальных ошибок нет", detail: "Метрические решения и словесные ударения всё равно требуют экспертной проверки." });
  return issues;
}

function buildExport(doc: DocumentState, meta: ReturnType<typeof deriveMetadata>) {
  const graphic = `@гр_строфика${doc.graphicStrophe ? ` ${doc.graphicStrophe}` : ""}`;
  const head = [
    "<html>", "<head>", `<title>${escapeHtml(doc.author)}. ${escapeHtml(doc.title)}</title>`,
    `<meta name='author' content='${escapeHtml(doc.author)}'>`, `<meta name='title' content='${escapeHtml(doc.title)}'>`,
    `<meta name='date' content='${escapeHtml(doc.date)}'>`, "@жанр стихотворение", `@цикл${doc.cycle ? ` ${doc.cycle}` : ""}`,
    `@строфика ${doc.strophe}`, graphic, `@метр ${meta.meter}`, `@клаузула ${meta.clausula}`,
    `@рифма ${meta.rhyme}`, `@доп${meta.effects.length ? ` ${meta.effects.join(", ")}` : ""}`,
    `@формула ${meta.formula}`, `@стопность ${meta.stopness}`, `@стихов ${doc.lines.length}`, "</head>", "<body>", "",
  ];
  const body = doc.lines.map((line, index) => {
    const open = index === 0 || line.breakBefore ? "<p class=verse>" : "";
    const close = index === doc.lines.length - 1 || doc.lines[index + 1]?.breakBefore ? "</p>" : "<br>";
    const meter = line.meter;
    return `${line.breakBefore && index ? "\n" : ""}${open}<#${meter}${line.starred ? "*" : ""}${line.feet}${line.clause}${line.scheme ? ` ${line.scheme}` : ""}>${line.text}${close}`;
  });
  return [...head, ...body, "", "</body>", "</html>"].join("\n");
}

function poemToDocument(poem: ImportedPoem): DocumentState {
  return {
    author: poem.author, title: poem.title, date: poem.date, cycle: poem.cycle,
    strophe: poem.fields["строфика"] || "0", graphicStrophe: poem.fields["гр_строфика"] || "",
    rhyme: poem.fields["рифма"]?.split(" | ")[0] || "0", rhymeScheme: poem.fields["рифма"]?.split(" | ")[1] || "",
    mode: "auto", effects: poem.fields["доп"]?.split(",").map((value) => value.trim()).filter(Boolean) || [],
    lines: poem.lines as VerseLine[],
  };
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [doc, setDoc] = useState<DocumentState>(sample);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"editor" | "metadata" | "source">("editor");
  const [saved, setSaved] = useState(true);
  const [copied, setCopied] = useState(false);
  const [corpora, setCorpora] = useState<ImportedCorpus[]>([]);
  const [poems, setPoems] = useState<ImportedPoem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [pendingRawImport, setPendingRawImport] = useState<RawTextImportDraft[] | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = useMemo(() => deriveMetadata(doc), [doc]);
  const issues = useMemo(() => validate(doc, meta), [doc, meta]);
  const exported = useMemo(() => buildExport(doc, meta), [doc, meta]);
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warningCount = issues.filter((issue) => issue.level === "warning").length;

  useEffect(() => {
    loadWorkspace().then((workspace) => {
      if (workspace) {
        setCorpora(workspace.corpora); setPoems(workspace.poems); setActiveId(workspace.activeId); setQueue(workspace.queue);
        const active = workspace.poems.find((poem) => poem.id === workspace.activeId);
        if (active) setDoc(poemToDocument(active));
      } else {
        const cached = localStorage.getItem("nkrya-poetry-draft");
        if (cached) try { setDoc(JSON.parse(cached)); } catch { /* compatibility with a malformed legacy draft */ }
      }
    }).finally(() => setWorkspaceReady(true));
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const timer = window.setTimeout(() => {
      saveWorkspace({ corpora, poems, activeId, queue }).then(() => {
        setSaved(true);
        setPoems((items) => items.some((poem) => poem.dirty) ? items.map((poem) => ({ ...poem, dirty: false })) : items);
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [corpora, poems, activeId, queue, workspaceReady]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (!saved || poems.some((poem) => poem.dirty)) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved, poems]);

  const updateDoc = (updater: DocumentState | ((current: DocumentState) => DocumentState)) => {
    setSaved(false);
    setDoc((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (activeId) setPoems((items) => items.map((poem) => poem.id === activeId ? {
        ...poem, author: next.author, title: next.title, date: next.date, cycle: next.cycle,
        lines: next.lines, dirty: true, modified: true, fields: { ...poem.fields, "строфика": next.strophe, "гр_строфика": next.graphicStrophe },
      } : poem));
      return next;
    });
  };
  const patchDoc = (value: Partial<DocumentState>) => updateDoc((current) => ({ ...current, ...value }));
  const patchLine = (index: number, value: Partial<VerseLine>) => updateDoc((current) => ({
    ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...value } : line),
  }));

  const runAnalysis = () => updateDoc((current) => ({
    ...current,
    lines: current.lines.map((line) => {
      if (line.meter && line.scheme) return line;
      const suggestion = suggestMeter(line.text);
      return { ...line, ...suggestion };
    }),
  }));



  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    try {
      const loaded = await Promise.all(files.map(async (file, order) => ({
        file, order: corpora.length + order, bytes: new Uint8Array(await file.arrayBuffer()),
      })));
      const imported = [] as ReturnType<typeof importCorpusBytes>[];
      const raw = [] as RawTextImportDraft[];
      for (const item of loaded) {
        const decoded = decodeCorpus(item.bytes);
        if (splitCorpus(decoded.text).length) imported.push(importCorpusBytes(item.bytes, item.file.name, item.order));
        else raw.push(createRawTextImport(item.bytes, item.file.name, item.order));
      }
      const newCorpora = imported.map((item) => item.corpus);
      const newPoems = imported.flatMap((item) => item.documents);
      if (newCorpora.length) {
        setCorpora((items) => [...items, ...newCorpora]);
        setPoems((items) => [...items, ...newPoems]);
        setQueue((items) => [...items, ...newPoems.map((poem) => poem.id)]);
        if (newPoems[0]) { setActiveId(newPoems[0].id); setDoc(poemToDocument(newPoems[0])); setSelected(0); }
        setSaved(false);
      }
      if (raw.length) setPendingRawImport(raw);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось прочитать выбранные файлы");
    } finally {
      event.target.value = "";
    }
  };

  const confirmRawImport = (drafts: RawTextImportDraft[]) => {
    const imported = drafts.map(finalizeRawTextImport);
    const newCorpora = imported.map((item) => item.corpus);
    const newPoems = imported.flatMap((item) => item.documents);
    setCorpora((items) => [...items, ...newCorpora]);
    setPoems((items) => [...items, ...newPoems]);
    setQueue((items) => [...items, ...newPoems.map((poem) => poem.id)]);
    if (newPoems[0]) { setActiveId(newPoems[0].id); setDoc(poemToDocument(newPoems[0])); setSelected(0); }
    setPendingRawImport(null);
    setSaved(false);
  };

  const selectPoem = (poem: ImportedPoem) => { setActiveId(poem.id); setDoc(poemToDocument(poem)); setSelected(0); };
  const deletePoem = (poemId: string) => {
    const remaining = poems.filter((poem) => poem.id !== poemId);
    setPoems(remaining); setQueue((items) => items.filter((id) => id !== poemId));
    if (activeId === poemId) { const next = remaining[0]; setActiveId(next?.id ?? null); if (next) setDoc(poemToDocument(next)); }
    setSaved(false);
  };
  const clearCorpus = () => { setCorpora([]); setPoems([]); setQueue([]); setActiveId(null); setSaved(false); };
  const setStatus = (status: ProcessingStatus) => {
    if (!activeId) return;
    setPoems((items) => items.map((poem) => poem.id === activeId ? { ...poem, status, dirty: true } : poem)); setSaved(false);
  };
  const downloadCorpora = () => corpora.forEach((corpus, index) => window.setTimeout(() => {
    try {
      const blob = new Blob([exportCorpusBytes(corpus, poems)], { type: `text/plain;charset=${corpus.encoding}` });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${corpus.name.replace(/\.(txt|html?)$/i, "")}-export.txt`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { window.alert(error instanceof Error ? error.message : "Не удалось экспортировать корпус"); }
  }, index * 150));

  const download = () => {
    const activePoem = poems.find((poem) => poem.id === activeId);
    const content = activePoem ? exportPoem({ ...activePoem, author: doc.author, title: doc.title, date: doc.date, cycle: doc.cycle }, doc.lines) : exported;
    const corpus = activePoem && corpora.find((item) => item.id === activePoem.corpusId);
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = encodeCorpus(content, corpus?.encoding ?? "utf-8"); }
    catch (error) { window.alert(error instanceof Error ? error.message : "Не удалось экспортировать произведение"); return; }
    const blob = new Blob([bytes], { type: `text/html;charset=${corpus?.encoding ?? "utf-8"}` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${doc.title.replace(/[<>:"/\\|?*«»…]/g, "").slice(0, 42) || "poem"}.htm`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const current = doc.lines[selected];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">СТ</span>
          <div><strong>Разметчик стихов</strong><span>формат НКРЯ</span></div>
        </div>
        <div className="top-actions">
          <span className={`save-state ${saved ? "is-saved" : ""}`}><i />{saved ? "Черновик сохранён" : "Сохранение…"}</span>
          <input ref={fileRef} type="file" multiple accept=".txt,.htm,.html,text/plain,text/html" hidden onChange={onFile} />
          <button className="button secondary" onClick={() => fileRef.current?.click()}><Icon>↥</Icon>Импорт</button>
          <button className="button primary" onClick={download}><Icon>↓</Icon>Скачать HTML</button>
        </div>
      </header>

      <section className="corpus-panel" aria-label="Импортированный корпус">
        <div className="corpus-summary">
          <strong>Корпусная очередь</strong><span>{corpora.length} корп. · {poems.length} произв.</span>
          <button className="button secondary" disabled={!corpora.length} onClick={downloadCorpora}>Скачать корпуса</button>
          <button className="delete" disabled={!poems.length} onClick={clearCorpus}>Очистить очередь</button>
        </div>
        {poems.length > 0 && <div className="poem-queue">{poems.map((poem) => <article key={poem.id} className={poem.id === activeId ? "active" : ""}>
          <button className="poem-select" onClick={() => selectPoem(poem)}><strong>{poem.title || "Без названия"}</strong><span>{poem.author || "Автор не указан"}</span><small>{corpora.find((corpus) => corpus.id === poem.corpusId)?.name} · {poem.sourceName}</small></button>
          <button className="queue-delete" aria-label={`Удалить ${poem.title}`} onClick={() => deletePoem(poem.id)}>×</button>
        </article>)}</div>}
        {activeId && <label className="status-control">Статус <select value={poems.find((poem) => poem.id === activeId)?.status ?? "unprocessed"} onChange={(event) => setStatus(event.target.value as ProcessingStatus)}>
          <option value="unprocessed">не обработано</option><option value="processing">обрабатывается</option><option value="ready">готово</option><option value="review">нужна проверка</option><option value="error">ошибка</option>
        </select></label>}
      </section>

      <section className="workspace">
        <aside className="sidebar left-panel">
          <div className="panel-heading"><span>Документ</span><button className="icon-button" title="Загрузить пример" onClick={() => updateDoc(sample)}>↺</button></div>
          <label>Автор<input value={doc.author} onChange={(e) => patchDoc({ author: e.target.value })} /></label>
          <label>Название<textarea rows={2} value={doc.title} onChange={(e) => patchDoc({ title: e.target.value })} /></label>
          <div className="field-grid">
            <label>Дата<input value={doc.date} onChange={(e) => patchDoc({ date: e.target.value })} /></label>
            <label>Цикл<input value={doc.cycle} onChange={(e) => patchDoc({ cycle: e.target.value })} placeholder="—" /></label>
          </div>
          <div className="section-label">Композиция</div>
          <label>Тип метрической организации
            <select value={doc.mode} onChange={(e) => patchDoc({ mode: e.target.value as DocumentState["mode"] })}>
              <option value="auto">Определять по строкам</option>
              <option value="heterometry">Гетерометрия</option>
              <option value="polymetry">Полиметрия</option>
              <option value="free">Вл</option>
            </select>
          </label>
          <div className="field-grid">
            <label>@строфика<input value={doc.strophe} onChange={(e) => patchDoc({ strophe: e.target.value })} /></label>
            <label>@гр_строфика<input value={doc.graphicStrophe} onChange={(e) => patchDoc({ graphicStrophe: e.target.value })} placeholder="пусто" /></label>
          </div>
          <label>Рифма
            <select value={doc.rhyme} onChange={(e) => patchDoc({ rhyme: e.target.value })}>
              <option value="0">0</option><option value="спорадическая">спорадическая</option><option value="вольная">вольная</option>
              <option value="парная">парная</option><option value="перекрестная">перекрёстная</option><option value="охватная">охватная</option><option value="сложная">сложная</option>
            </select>
          </label>
          <label>Схема рифмовки<input value={doc.rhymeScheme} onChange={(e) => patchDoc({ rhymeScheme: e.target.value })} placeholder="например, абаб" /></label>
          <div className="section-label">Дополнительные эффекты</div>
          <div className="checks">
            {EFFECTS.map((effect) => <label className="check" key={effect}><input type="checkbox" checked={doc.effects.includes(effect)} onChange={(e) => patchDoc({ effects: e.target.checked ? [...doc.effects, effect] : doc.effects.filter((x) => x !== effect) })} /><span>{effect}</span></label>)}
          </div>
        </aside>

        <section className="editor-panel">
          <div className="document-header">
            <div>
              <p className="eyebrow">{doc.author || "Автор не указан"}</p>
              <h1>{doc.title || "Без названия"}</h1>
            </div>
            <div className="document-stats"><span>{doc.lines.length} строк</span><span className={errorCount ? "bad" : "good"}>{errorCount ? `${errorCount} ошибок` : "Готово к проверке"}</span></div>
          </div>
          <nav className="tabs" aria-label="Режим редактора">
            <button className={view === "editor" ? "active" : ""} onClick={() => setView("editor")}>Строки</button>
            <button className={view === "metadata" ? "active" : ""} onClick={() => setView("metadata")}>Метаданные</button>
            <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>Исходный код</button>
            <button className="analyze" onClick={runAnalysis}><Icon>◇</Icon>Первичный анализ</button>
          </nav>

          {view === "editor" && <div className="line-editor">
            <div className="line-head"><span>№</span><span>Строка</span><span>Метр</span><span>Ст.</span><span>Кл.</span><span>Схема</span></div>
            {doc.lines.map((line, index) => <div key={line.id}>
              {line.breakBefore && <div className="part-break"><span>{doc.mode === "polymetry" ? "Новая часть" : "Пробельная строка"}</span></div>}
              <div className={`line-row ${selected === index ? "selected" : ""}`} onClick={() => setSelected(index)}>
                <button className="line-number" onClick={() => setSelected(index)}>{String(index + 1).padStart(2, "0")}</button>
                <textarea aria-label={`Текст строки ${index + 1}`} rows={1} value={line.text} onChange={(e) => patchLine(index, { text: e.target.value })} />
                <select aria-label={`Метр строки ${index + 1}`} value={line.meter} onChange={(e) => patchLine(index, { meter: e.target.value as Meter })}>{METERS.map((meter) => <option key={meter || "blank"} value={meter}>{meter || "—"}</option>)}</select>
                <input aria-label={`Стопность строки ${index + 1}`} type="number" min="1" max="20" value={line.feet} onChange={(e) => patchLine(index, { feet: Number(e.target.value) })} />
                <select aria-label={`Клаузула строки ${index + 1}`} value={line.clause} onChange={(e) => patchLine(index, { clause: e.target.value as Clause })}><option>м</option><option>ж</option><option>д</option><option>г</option></select>
                <input className="scheme" aria-label={`Схема строки ${index + 1}`} value={line.scheme} onChange={(e) => patchLine(index, { scheme: e.target.value })} placeholder="1*1*…" />
              </div>
            </div>)}
            <button className="add-line" onClick={() => updateDoc((currentDoc) => ({ ...currentDoc, lines: [...currentDoc.lines, { id: uid(), text: "", meter: "", feet: 1, clause: "м", scheme: "", breakBefore: false, starred: false, note: "" }] }))}>＋ Добавить строку</button>
          </div>}

          {view === "metadata" && <div className="metadata-view">
            {[ ["@метр", meta.meter], ["@клаузула", meta.clausula], ["@рифма", meta.rhyme], ["@доп", meta.effects.join(", ")], ["@формула", meta.formula], ["@стопность", meta.stopness], ["@стихов", String(doc.lines.length)] ].map(([name, value]) => <div className="meta-row" key={name}><code>{name}</code><span>{value || <em>пусто</em>}</span></div>)}
            <p className="metadata-note">Поля пересчитываются после каждого изменения строк. Редкие формулы и сложные композиции требуют ручной проверки.</p>
          </div>}

          {view === "source" && <div className="source-view"><textarea value={exported} readOnly spellCheck={false} /><button className="copy-button" onClick={async () => { await navigator.clipboard.writeText(exported); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? "Скопировано" : "Копировать код"}</button></div>}
        </section>

        <aside className="sidebar right-panel">
          <div className="panel-heading"><span>Проверка</span><span className={`score ${errorCount ? "has-errors" : ""}`}>{errorCount ? `${errorCount} / ${warningCount}` : warningCount ? `${warningCount} замеч.` : "OK"}</span></div>
          {current && <div className="line-inspector">
            <div className="inspector-title"><span>Строка {selected + 1}</span><button className="delete" title="Удалить строку" onClick={() => { patchDoc({ lines: doc.lines.filter((_, i) => i !== selected) }); setSelected(Math.max(0, selected - 1)); }}>Удалить</button></div>
            <div className="syllable-stat"><strong>{countSyllables(current.text)}</strong><span>слогов</span><strong>{stressedSyllables(current.text).length}</strong><span>ударений</span></div>
            <label>Комментарий<input value={current.note} onChange={(e) => patchLine(selected, { note: e.target.value })} placeholder="Почему выбрана схема" /></label>
            <div className="inline-checks">
              <label className="check"><input type="checkbox" checked={current.starred} onChange={(e) => patchLine(selected, { starred: e.target.checked })} /><span>Перебой *</span></label>
              <label className="check"><input type="checkbox" checked={current.breakBefore} disabled={selected === 0} onChange={(e) => patchLine(selected, { breakBefore: e.target.checked })} /><span>{doc.mode === "polymetry" ? "Начало части" : "Пробел перед строкой"}</span></label>
            </div>
          </div>}
          <div className="issues">
            {issues.map((issue, index) => <button key={`${issue.title}-${index}`} className={`issue ${issue.level}`} onClick={() => { if (issue.line) { setSelected(issue.line - 1); setView("editor"); } }}>
              <span className="issue-mark">{issue.level === "error" ? "!" : issue.level === "warning" ? "?" : "✓"}</span>
              <span><strong>{issue.title}{issue.line ? ` · строка ${issue.line}` : ""}</strong><small>{issue.detail}</small></span>
            </button>)}
          </div>
          <div className="rule-card"><span>Приоритет разбора</span><strong>Силлабо-тоника → Дк → Тк → Ак → Вл</strong><p>Выбирайте наиболее строгую схему, которую допускают ударения и контекст стихотворения.</p></div>
        </aside>
      </section>
      {pendingRawImport && <RawImportDialog drafts={pendingRawImport} onCancel={() => setPendingRawImport(null)} onConfirm={confirmRawImport} />}
    </main>
  );
}
