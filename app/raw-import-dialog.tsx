"use client";

import { useMemo, useRef, useState } from "react";
import { mergeRawPoemWithPrevious, splitRawPoemAt, type RawPoemDraft, type RawTextImportDraft } from "./raw-text";

type RawImportDialogProps = {
  drafts: RawTextImportDraft[];
  onCancel: () => void;
  onConfirm: (drafts: RawTextImportDraft[]) => void;
};

function lineCount(poem: RawPoemDraft) {
  return poem.body.split("\n").filter((line) => line.trim()).length;
}

export function RawImportDialog({ drafts, onCancel, onConfirm }: RawImportDialogProps) {
  const [working, setWorking] = useState(() => drafts.map((draft) => ({ ...draft, poems: draft.poems.map((poem) => ({ ...poem })) })));
  const [fileIndex, setFileIndex] = useState(0);
  const [poemIndex, setPoemIndex] = useState(0);
  const [message, setMessage] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const file = working[fileIndex];
  const poem = file?.poems[poemIndex];
  const totalPoems = useMemo(() => working.reduce((sum, item) => sum + item.poems.length, 0), [working]);
  const uncertain = useMemo(() => working.reduce((sum, item) => sum + item.poems.filter((item) => item.confidence !== "high").length, 0), [working]);

  const updateFile = (updater: (current: RawTextImportDraft) => RawTextImportDraft) => {
    setWorking((items) => items.map((item, index) => index === fileIndex ? updater(item) : item));
  };

  const updatePoem = (value: Partial<RawPoemDraft>) => {
    if (!file || !poem) return;
    updateFile((current) => ({
      ...current,
      poems: current.poems.map((item, index) => index === poemIndex ? { ...item, ...value } : item),
    }));
  };

  const splitAtCursor = () => {
    if (!poem) return;
    const result = splitRawPoemAt(poem, bodyRef.current?.selectionStart ?? 0);
    if (!result) {
      setMessage("Поставьте курсор в начало строки, с которой должно начинаться новое произведение.");
      return;
    }
    updateFile((current) => ({
      ...current,
      poems: [...current.poems.slice(0, poemIndex), ...result, ...current.poems.slice(poemIndex + 1)],
    }));
    setPoemIndex(poemIndex + 1);
    setMessage("Добавлена новая граница. Проверьте название нового произведения.");
  };

  const mergePrevious = () => {
    if (!file || poemIndex === 0) return;
    updateFile((current) => ({ ...current, poems: mergeRawPoemWithPrevious(current.poems, poemIndex) }));
    setPoemIndex(poemIndex - 1);
    setMessage("Граница удалена; текст присоединён к предыдущему произведению.");
  };

  const removePoem = () => {
    if (!file || !poem) return;
    updateFile((current) => ({ ...current, poems: current.poems.filter((_, index) => index !== poemIndex) }));
    setPoemIndex(Math.max(0, Math.min(poemIndex, file.poems.length - 2)));
    setMessage("Фрагмент исключён из импорта.");
  };

  if (!file) return null;

  return <div className="raw-dialog-backdrop">
    <section className="raw-dialog" role="dialog" aria-modal="true" aria-labelledby="raw-dialog-title">
      <header className="raw-dialog-header">
        <div>
          <p>Импорт без предварительной разметки</p>
          <h2 id="raw-dialog-title">Проверьте границы произведений</h2>
        </div>
        <button className="raw-dialog-close" aria-label="Закрыть" onClick={onCancel}>×</button>
      </header>

      <div className="raw-dialog-toolbar">
        <label>Файл
          <select value={fileIndex} onChange={(event) => { setFileIndex(Number(event.target.value)); setPoemIndex(0); setMessage(""); }}>
            {working.map((item, index) => <option key={item.id} value={index}>{item.name} · {item.poems.length}</option>)}
          </select>
        </label>
        <label>Автор для этого файла
          <input value={file.author} onChange={(event) => updateFile((current) => ({ ...current, author: event.target.value }))} placeholder="Например, Новелла Матвеева" />
        </label>
        {working.length > 1 && <button className="button secondary" disabled={!file.author.trim()} onClick={() => setWorking((items) => items.map((item) => ({ ...item, author: file.author })))}>Применить автора ко всем</button>}
      </div>

      <div className="raw-dialog-summary">
        <span>Найдено: <strong>{totalPoems}</strong></span>
        <span>Нужно проверить: <strong>{uncertain}</strong></span>
        <p>Пустая строка внутри текста считается границей строфы. Ударения и метр пока не добавляются.</p>
      </div>

      <div className="raw-dialog-content">
        <aside className="raw-poem-list" aria-label="Найденные произведения">
          {file.poems.map((item, index) => <button key={item.id} className={index === poemIndex ? "active" : ""} onClick={() => { setPoemIndex(index); setMessage(""); }}>
            <span className={`raw-confidence ${item.confidence}`} title={item.reason} />
            <span><strong>{item.title || "Без названия"}</strong><small>{lineCount(item)} строк · {item.reason}</small></span>
          </button>)}
          {!file.poems.length && <p className="raw-empty">В этом файле не осталось фрагментов.</p>}
        </aside>

        <div className="raw-poem-editor">
          {poem ? <>
            <label>Предполагаемое название
              <input value={poem.title} onChange={(event) => updatePoem({ title: event.target.value, confidence: "high", reason: "Название проверено вручную" })} />
            </label>
            <label>Текст
              <textarea ref={bodyRef} value={poem.body} onChange={(event) => updatePoem({ body: event.target.value })} spellCheck={false} />
            </label>
            <div className="raw-edit-actions">
              <button className="button secondary" onClick={splitAtCursor}>Разделить по курсору</button>
              <button className="button secondary" disabled={poemIndex === 0} onClick={mergePrevious}>Объединить с предыдущим</button>
              <button className="delete" onClick={removePoem}>Исключить фрагмент</button>
            </div>
            <p className="raw-help">Чтобы добавить границу, поставьте курсор в строку с названием или первой строкой следующего стихотворения и нажмите «Разделить по курсору».</p>
          </> : <div className="raw-no-selection">Выберите произведение или отмените импорт файла.</div>}
          {message && <p className="raw-message" role="status">{message}</p>}
        </div>
      </div>

      <footer className="raw-dialog-footer">
        <button className="button secondary" onClick={onCancel}>Отмена</button>
        <button className="button primary" disabled={!totalPoems} onClick={() => onConfirm(working)}>Создать корпус · {totalPoems}</button>
      </footer>
    </section>
  </div>;
}
