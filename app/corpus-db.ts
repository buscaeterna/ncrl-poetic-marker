import type { ImportedCorpus, ImportedPoem } from "./corpus";

export type CorpusWorkspace = { corpora: ImportedCorpus[]; poems: ImportedPoem[]; activeId: string | null; queue: string[] };
const DB_NAME = "nkrya-poetry-corpora";
const STORE = "workspace";
const KEY = "current";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspace(): Promise<CorpusWorkspace | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(value: CorpusWorkspace) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(value, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
