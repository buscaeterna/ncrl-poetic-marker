import test from "node:test";
import assert from "node:assert/strict";
import { acceptStressSuggestion, editLineText, exportPoem } from "../app/corpus.ts";

const line = {id:"l",text:"погода",meter:"",feet:0,clause:"м",scheme:"",breakBefore:false,starred:false,note:"",
  stressSuggestion:{sourceText:"погода",suggestedText:"пого`да",sourceHash:"x",state:"pending",confidence:.95,
    uncertainWords:[],words:[],engine:"fake",engineVersion:"1",analysedAt:"2026-01-01T00:00:00Z"}};
test("unaccepted stress never enters export, accepted stress does",()=>{
  const poem={id:"p",corpusId:"c",sourceName:"p.htm",sourceOrder:0,author:"",title:"",date:"",cycle:"",fields:{},structures:[],originalHtml:"original",lines:[line],status:"review",dirty:false,modified:false};
  assert.equal(exportPoem(poem),"original");
  const accepted=acceptStressSuggestion(line);
  assert.equal(accepted.text,"пого`да");
  assert.match(exportPoem({...poem,modified:true,lines:[accepted]}),/пого`да/);
});
test("editing makes a suggestion stale and prevents acceptance",()=>{
  const edited=editLineText(line,"другая");
  assert.equal(edited.stressSuggestion.state,"stale");
  assert.equal(acceptStressSuggestion(edited).text,"другая");
});
