import test from "node:test";
import assert from "node:assert/strict";
import { acceptStressSuggestion, acceptStressWord, editLineText, exportPoem } from "../app/corpus.ts";

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
test("one word or an explicit homograph alternative can be accepted",()=>{
 const value={...line,text:"замок погода",stressSuggestion:{...line.stressSuggestion,sourceText:"замок погода",suggestedText:"за`мок пого`да",words:[{original:"замок",normalized:"замок",position:1,confidence:.5,alternatives:[3],ambiguous:true,source:"model"},{original:"погода",normalized:"погода",position:3,confidence:.9,alternatives:[],ambiguous:false,source:"model"}]}};
 const chosen=acceptStressWord(value,0,3);
 assert.equal(chosen.text,"замо`к погода");
 assert.equal(acceptStressSuggestion(chosen).text,"замо`к пого`да");
 assert.equal(acceptStressWord(value,1).text,"замок пого`да");
});

test("stress dialog selects current or every poem",async()=>{
 const {stressSelection}=await import("../app/stress-dialog.tsx");
 const poems=[{id:"a"},{id:"b"}];
 assert.deepEqual([...stressSelection(poems,"current","b")],["b"]);
 assert.deepEqual([...stressSelection(poems,"all","b")],["a","b"]);
});
