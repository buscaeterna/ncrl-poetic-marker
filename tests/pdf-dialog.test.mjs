import test from 'node:test';
import assert from 'node:assert/strict';
import {canImportPdf,clearCancelledPdfImport,jobMatchesPage,planPdfBatch,projectSaveOutcome} from '../app/pdf-import-state.ts';

test('batch order starts after the highest surviving upload order',()=>{
  const files=['slow.pdf','fast.pdf'];
  const plan=planPdfBatch([{upload_order:2},{upload_order:8}],files);
  assert.deepEqual(plan,[{file:'slow.pdf',uploadOrder:9},{file:'fast.pdf',uploadOrder:10}]);
  assert.deepEqual(plan.map(item=>item.file),files,'response timing cannot reorder the assigned order');
});
test('OCR state only belongs to its originating document and page',()=>{
  const job={id:'j',status:'running',progress:.5,error:null,documentId:'doc-a',pageNumber:3};
  assert.equal(jobMatchesPage(job,'doc-a',3),true);
  assert.equal(jobMatchesPage(job,'doc-a',4),false);
  assert.equal(jobMatchesPage(job,'doc-b',3),false);
});
test('cancelling PDF raw review clears both pending values',()=>{
  assert.deepEqual(clearCancelledPdfImport(),{pendingRawImport:null,pendingPdfSource:null});
});
test('prepared import survives 409 and commits on retry',()=>{
  const prepared={text:'reviewed',provenance:{sourceDocumentId:'doc'}};
  const conflict=projectSaveOutcome(prepared,409);
  assert.equal(conflict.prepared,prepared);assert.equal(conflict.retryable,true);
  const retry=projectSaveOutcome(conflict.prepared,200);
  assert.equal(retry.committed,prepared);assert.equal(retry.prepared,null);
});
test('both review and immutable approved sources can be imported',()=>{
  assert.equal(canImportPdf('review'),true);assert.equal(canImportPdf('approved'),true);
  assert.equal(canImportPdf('extracting'),false);
});
