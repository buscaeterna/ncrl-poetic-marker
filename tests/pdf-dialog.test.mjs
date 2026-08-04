import test from 'node:test';
import assert from 'node:assert/strict';
import {canImportPdf,clearCancelledPdfImport,jobMatchesPage,planPdfBatch,trackOcrJob} from '../app/pdf-import-state.ts';

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
test('both review and immutable approved sources can be imported',()=>{
  assert.equal(canImportPdf('review'),true);assert.equal(canImportPdf('approved'),true);
  assert.equal(canImportPdf('extracting'),false);
});

test('two page OCR jobs remain independently addressable',()=>{
 let jobs={};
 jobs=trackOcrJob(jobs,{id:'one',status:'running',progress:.2,error:null,documentId:'doc',pageNumber:1});
 jobs=trackOcrJob(jobs,{id:'two',status:'queued',progress:0,error:null,documentId:'doc',pageNumber:2});
 assert.equal(jobs['doc:1'].id,'one');assert.equal(jobs['doc:2'].id,'two');
 const cancelled=trackOcrJob(jobs,{...jobs['doc:1'],status:'cancelled'});
 assert.equal(cancelled['doc:1'].status,'cancelled');assert.equal(cancelled['doc:2'].status,'queued');
});
