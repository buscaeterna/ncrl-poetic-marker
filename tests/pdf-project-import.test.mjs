import test from 'node:test';import assert from 'node:assert/strict';
import {mergePdfImport,persistPdfProjectImport} from '../app/pdf-project-import.ts';
const project=(revision,workspace)=>({id:'project',name:'P',schema_version:1,revision,workspace});
const oldPoem={id:'old',provenance:undefined};const imported={id:'new',provenance:{sourceDocumentId:'pdf-1'}};
const empty={corpora:[],poems:[],activeId:null,queue:[]};
const additions={corpora:[{id:'corpus'}],poems:[imported]};
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('real persistence retries 409 against fresh workspace without overwriting server poems',async()=>{
 const fresh={corpora:[],poems:[oldPoem],activeId:'old',queue:['old']};const calls=[];
 const fetcher=async(url,init)=>{calls.push([url,init]);if(calls.length===1)return response(409,{});if(calls.length===2)return response(200,project(2,fresh));const body=JSON.parse(init.body);return response(200,project(3,body.workspace))};
 const result=await persistPdfProjectImport({project:project(1,empty),baseWorkspace:empty,...additions,sourceDocumentId:'pdf-1',fetcher});
 assert.equal(calls.length,3);assert.deepEqual(result.workspace.poems.map(p=>p.id),['old','new']);assert.equal(JSON.parse(calls[2][1].body).revision,2);
});
test('lost successful response is idempotent when fresh project already contains provenance',async()=>{
 const saved=mergePdfImport(empty,additions,'pdf-1');let calls=0;const fetcher=async()=>{calls++;return calls===1?response(409,{}):response(200,project(2,saved))};
 const result=await persistPdfProjectImport({project:project(1,empty),baseWorkspace:empty,...additions,sourceDocumentId:'pdf-1',fetcher});
 assert.equal(calls,2);assert.equal(result.alreadyImported,true);assert.equal(result.workspace.poems.length,1);
});
