export type OrderedSource = { upload_order: number };
export type PageIdentity = { documentId: string; pageNumber: number };
export type TrackedOcrJob = PageIdentity & { id: string; status: string; progress: number; error: string | null };

export function planPdfBatch<T>(existing: OrderedSource[], files: readonly T[]) {
  const start = existing.reduce((maximum, source) => Math.max(maximum, source.upload_order), -1) + 1;
  return files.map((file, index) => ({ file, uploadOrder: start + index }));
}
export const jobMatchesPage = (job: TrackedOcrJob | null, documentId: string, pageNumber: number) =>
  Boolean(job && job.documentId === documentId && job.pageNumber === pageNumber);
export const clearCancelledPdfImport = () => ({ pendingRawImport: null, pendingPdfSource: null });
export const canImportPdf = (status: string) => status === "review" || status === "approved";
export const trackOcrJob = (jobs:Record<string,TrackedOcrJob>, job:TrackedOcrJob) => ({...jobs,[`${job.documentId}:${job.pageNumber}`]:job});
