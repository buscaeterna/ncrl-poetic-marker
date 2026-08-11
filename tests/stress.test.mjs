import test from "node:test";
import assert from "node:assert/strict";
import { acceptStressSuggestion, acceptStressWord, editLineText, exportPoem, sha256Text } from "../app/corpus.ts";

const line = {id:"l",text:"погода",meter:"",feet:0,clause:"м",scheme:"",breakBefore:false,starred:false,note:"",
  stressSuggestion:{sourceText:"погода",suggestedText:"пого`да",sourceHash:sha256Text("погода"),state:"pending",confidence:.95,
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
 const value={...line,text:"замок погода",stressSuggestion:{...line.stressSuggestion,sourceText:"замок погода",suggestedText:"за`мок пого`да",sourceHash:sha256Text("замок погода"),words:[{original:"замок",normalized:"замок",position:1,confidence:.5,alternatives:[3],ambiguous:true,source:"model"},{original:"погода",normalized:"погода",position:3,confidence:.9,alternatives:[],ambiguous:false,source:"model"}]}};
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

test("a pending suggestion with mismatched text cannot apply a line or word",()=>{
 const broken={...line,text:"чужой текст"};
 assert.equal(acceptStressSuggestion(broken),broken);
 assert.equal(acceptStressWord({...broken,stressSuggestion:{...broken.stressSuggestion,words:[{original:"погода",normalized:"погода",position:3,confidence:1,alternatives:[],ambiguous:false,source:"model"}]}},0).text,"чужой текст");
});

test("two words can be accepted sequentially with a homograph alternative",()=>{
 const suggestion={...line.stressSuggestion,sourceText:"замок погода",sourceHash:sha256Text("замок погода"),suggestedText:"за`мок пого`да",words:[{original:"замок",normalized:"замок",position:1,confidence:.5,alternatives:[3],ambiguous:true,source:"model"},{original:"погода",normalized:"погода",position:3,confidence:.9,alternatives:[],ambiguous:false,source:"model"}]};
 const first=acceptStressWord({...line,text:suggestion.sourceText,stressSuggestion:suggestion},0,3),second=acceptStressWord(first,1);
 assert.equal(second.text,"замо`к пого`да");
 assert.deepEqual(second.stressSuggestion.acceptedWords,[{wordIndex:0,position:3},{wordIndex:1,position:3}]);
});

test("stress recovery prefers an active job and otherwise restores terminal results",async()=>{
 const {recoverStressJob}=await import("../app/stress-dialog.tsx");
 const succeeded={id:"done",type:"stress_analysis",status:"succeeded"},cancelled={id:"cancel",type:"stress_analysis",status:"cancelled"},running={id:"run",type:"stress_analysis",status:"running"};
 assert.equal(recoverStressJob([succeeded,running]).id,"run");
 assert.equal(recoverStressJob([succeeded]).id,"done");
 assert.equal(recoverStressJob([cancelled]).id,"cancel");
 assert.equal(recoverStressJob([{id:"other",type:"workspace_summary",status:"running"}]),null);
});

test("recovered project revision is used to accept and persist without a stale revision",async()=>{
 const {stressProjectUpdate}=await import("../app/stress-dialog.tsx"),accepted=acceptStressSuggestion(line);
 const fresh={id:"project",name:"P",schema_version:1,revision:7},workspace={corpora:[],poems:[{lines:[accepted]}],activeId:null,queue:[]};
 assert.equal(stressProjectUpdate(fresh,workspace).revision,7);
 assert.equal(stressProjectUpdate(fresh,workspace).workspace.poems[0].lines[0].text,"пого`да");
});

test("a new analysis can start after a recovered cancelled or succeeded job",async()=>{
 const {canStartStressJob}=await import("../app/stress-dialog.tsx");
 assert.equal(canStartStressJob({status:"running"}),false);
 assert.equal(canStartStressJob({status:"cancel_requested"}),false);
 assert.equal(canStartStressJob({status:"cancelled"}),true);
 assert.equal(canStartStressJob({status:"succeeded"}),true);
});

test("all stress text acceptance paths stale the poem-level meter summary",async()=>{
 const {updateStressLine}=await import("../app/stress-dialog.tsx"),work={sourceSignature:"old",state:"pending",warnings:[],metadataSuggestion:{meter:"Я",formula:"",stopness:"4",sourceSignature:"old",state:"pending",explanation:""}};
 const poem={id:"p",lines:[line],dirty:false,modified:false,meterWorkSuggestion:work};
 assert.equal(updateStressLine(poem,"l",acceptStressSuggestion).meterWorkSuggestion.state,"stale");
 const batch=[poem,{...poem,id:"p2"}].map(item=>updateStressLine(item,"l",acceptStressSuggestion));assert.ok(batch.every(item=>item.meterWorkSuggestion.state==="stale"));
 const wordLine={...line,stressSuggestion:{...line.stressSuggestion,words:[{original:"погода",normalized:"погода",position:3,confidence:1,alternatives:[],ambiguous:false,source:"dictionary"}]}};
 assert.equal(updateStressLine({...poem,lines:[wordLine]},"l",value=>acceptStressWord(value,0)).meterWorkSuggestion.state,"stale");
 assert.equal(updateStressLine(poem,"l",value=>editLineText(value,"ручная правка")).meterWorkSuggestion.state,"stale");
 assert.equal(updateStressLine({...poem,lines:[{...line,text:"пого`да"}]},"l",value=>editLineText(value,"погода")).meterWorkSuggestion.state,"stale");
});
