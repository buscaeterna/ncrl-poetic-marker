import test from "node:test";import assert from "node:assert/strict";
import {applyWorkMetadata,bulkAcceptExact,canApplyWorkMetadata,canBulkAcceptMeter,invalidateWorkSuggestion,poemMeterSignature,recoverMeterJob,restoreWorkMetadata,updateLineInterpretation,validateManualLine} from "../app/meter-dialog.tsx";
import {acceptMeterSuggestion,exportCorpus,exportPoem,METER_ANALYZER_VERSION,replacePoemLines,restoreImportedAnnotation,sha256Text,updatePoemFromEditor} from "../app/corpus.ts";
test("meter dialog restores active and terminal job states",()=>{
 for(const status of ["running","succeeded","cancelled","failed"]){const jobs=[{id:"x",type:"meter_analysis",status,progress:0,error:null}];assert.equal(recoverMeterJob(jobs).status,status)}
 assert.equal(recoverMeterJob([{id:"old",type:"meter_analysis",status:"succeeded",progress:1,error:null},{id:"new",type:"meter_analysis",status:"running",progress:0,error:null}]).id,"new");
});
test("bulk acceptance is selected, current, exact, and excludes imported/manual annotation",()=>{
 const text="а` а`",candidate={meter:"Тк",feetOrIctuses:2,ictusPositions:[0,1],anacrusis:0,ictusOmissions:[],weakStresses:[],violations:[],regular:true};
 const line={id:"l",text,meter:"",feet:0,clause:"м",scheme:"",starred:false,breakBefore:false,note:"",meterSuggestion:{sourceText:text,sourceHash:sha256Text(text),analyzerVersion:METER_ANALYZER_VERSION,syllables:[],words:[],accentSequence:"11",candidates:[candidate],selected:candidate,clause:"м",unknownWords:[],explanation:"",quality:"exact",state:"pending",analysedAt:"",warnings:[]}};
 const poem={id:"p",lines:[line]};assert.equal(canBulkAcceptMeter(new Set(["p"]),poem,line),true);
 assert.equal(canBulkAcceptMeter(new Set(),poem,line),false);assert.equal(canBulkAcceptMeter(new Set(["p"]),poem,{...line,annotationSource:"manual"}),false);assert.equal(canBulkAcceptMeter(new Set(["p"]),poem,{...line,importedAnnotation:{meter:"Я",feet:4,clause:"м",scheme:"",starred:false}}),false);
});
test("strict manual line validation rejects unsupported or malformed values",()=>{
 assert.deepEqual(validateManualLine("Я","4","ж"),{meter:"Я",feet:4,clause:"ж"});
 for(const args of [["Вл","4","м"],["Я","0","м"],["Я","1.5","м"],["Я","x","м"],["Я","4","x"],[null,"4","м"]])assert.equal(validateManualLine(...args),null);
});
test("work metadata is viewed/applied fieldwise and imported values are restorable",()=>{
 const line={id:"l",text:"а` а`",meter:"",feet:0,clause:"м",scheme:"",starred:false,breakBefore:false,note:""};
 let poem={id:"p",lines:[line],fields:{"метр":"импорт","формула":"старая","стопность":"3","клаузула":"ж"},rawText:false};
 const signature=poemMeterSignature(poem);poem={...poem,meterWorkSuggestion:{sourceSignature:signature,state:"pending",warnings:[{rule:"R011",message:"basis"}],metadataSuggestion:{meter:"Тк",formula:"Тк2м",stopness:"2",clause:"м",clauseSequence:["м"],sourceSignature:signature,state:"pending",acceptedFields:[],explanation:"exact"}}};
 const accepted=applyWorkMetadata(poem,"meter");assert.equal(accepted.editorMetadata.meter.manual,"Тк");assert.equal(accepted.editorMetadata.meter.original,"импорт");assert.deepEqual(accepted.meterWorkSuggestion.metadataSuggestion.acceptedFields,["meter"]);
 const restored=restoreWorkMetadata(accepted,"meter");assert.equal(restored.editorMetadata.meter.manual,undefined);assert.equal(restored.editorMetadata.meter.original,"импорт");
 assert.deepEqual(restored.meterWorkSuggestion.metadataSuggestion.acceptedFields,[]);assert.equal(restored.meterWorkSuggestion.metadataSuggestion.state,"pending");
 const stale={...poem,meterWorkSuggestion:{...poem.meterWorkSuggestion,state:"stale"}};assert.equal(canApplyWorkMetadata(stale),false);assert.equal(applyWorkMetadata(stale,"meter"),stale);
});
const completePoem=(line,extra={})=>({id:"p",corpusId:"c",sourceName:"p.htm",sourceOrder:0,author:"",title:"P",date:"????",cycle:"",fields:{"метр":"старый","формула":"старая","стопность":"3","клаузула":"ж"},structures:[{kind:"verse",html:"<p class=verse>а` а`</p>",lines:["а` а`"]}],originalHtml:"<html><head>@метр старый\n@формула старая\n@стопность 3</head><body><p class=verse>а` а`</p></body></html>",lines:[line],status:"ready",dirty:false,modified:false,...extra});
test("bulk exact acceptance changes only eligible poems and immediately exports line annotation",()=>{
 const text="а` а`",candidate={meter:"Тк",feetOrIctuses:2,ictusPositions:[0,1],anacrusis:0,ictusOmissions:[],weakStresses:[],violations:[],regular:true};
 const suggestion={sourceText:text,sourceHash:sha256Text(text),analyzerVersion:METER_ANALYZER_VERSION,syllables:[],words:[],accentSequence:"11",candidates:[candidate],selected:candidate,clause:"м",unknownWords:[],explanation:"",quality:"exact",state:"pending",analysedAt:"",warnings:[]};
 const line={id:"l",text,meter:"",feet:0,clause:"м",scheme:"",starred:false,breakBefore:false,note:"",meterSuggestion:suggestion},poem=completePoem(line),untouched=completePoem({...line,id:"other"},{id:"other",sourceName:"other.htm"});
 const single={...poem,modified:true,lines:[acceptMeterSuggestion(line)]};assert.match(exportPoem(single),/<#Тк2м>а` а`/);
 const result=bulkAcceptExact([poem,untouched],new Set(["p"]));assert.equal(result[0].modified,true);assert.equal(result[0].dirty,true);assert.equal(result[1],untouched);
 assert.match(exportPoem(result[0]),/<#Тк2м>а` а`/);assert.match(exportCorpus({id:"c",name:"c",encoding:"utf-8",order:0,eol:"\n"},result),/<#Тк2м>а` а`/);
});
test("accepted work metadata exports immediately, while pending metadata does not",()=>{
 const line={id:"l",text:"а` а`",meter:"",feet:0,clause:"м",scheme:"",starred:false,breakBefore:false,note:""};let poem=completePoem(line),signature=poemMeterSignature(poem);
 poem={...poem,meterWorkSuggestion:{sourceSignature:signature,state:"pending",warnings:[],metadataSuggestion:{meter:"Тк",formula:"Тк2м",stopness:"2",clause:"м",sourceSignature:signature,state:"pending",acceptedFields:[],explanation:""}}};
 assert.equal(exportPoem({...poem,modified:true}).includes("@метр Тк"),false);
 for(const key of ["meter","formula","stopness","clause"])poem=applyWorkMetadata(poem,key);
 const html=exportPoem(poem);assert.match(html,/@метр Тк/);assert.match(html,/@формула Тк2м/);assert.match(html,/@стопность 2/);assert.match(html,/@клаузула м/);
});
test("alternative/manual/restore interpretation invalidates work summary",()=>{
 const base=completePoem({id:"l",text:"а` а`",meter:"Я",feet:2,clause:"м",scheme:"",starred:false,breakBefore:false,note:"",importedAnnotation:{meter:"Я",feet:2,clause:"м",scheme:"",starred:false}},{meterWorkSuggestion:{sourceSignature:"x",state:"pending",warnings:[],metadataSuggestion:{meter:"Я",formula:"",stopness:"2",sourceSignature:"x",state:"pending",explanation:""}}});
 assert.equal(invalidateWorkSuggestion(base).meterWorkSuggestion.state,"stale");
 const manual=updateLineInterpretation(base,"l",line=>({...line,meter:"Х",annotationSource:"manual"}));assert.equal(manual.meterWorkSuggestion.state,"stale");assert.equal(manual.lines[0].meter,"Х");
 const restored=updateLineInterpretation(manual,"l",restoreImportedAnnotation);assert.equal(restored.meterWorkSuggestion.state,"stale");assert.equal(restored.lines[0].meter,"Я");
});
test("text edits and line composition changes stale the poem suggestion",()=>{
 const line={id:"l",text:"строка",meter:"",feet:0,clause:"м",scheme:"",starred:false,breakBefore:false,note:""},work={sourceSignature:"x",state:"pending",warnings:[],metadataSuggestion:{meter:"Я",formula:"",stopness:"4",sourceSignature:"x",state:"pending",explanation:""}},poem=completePoem(line,{meterWorkSuggestion:work});
 assert.equal(replacePoemLines(poem,[{...line,text:"правка"}]).meterWorkSuggestion.state,"stale");
 assert.equal(replacePoemLines(poem,[line,{...line,id:"new"}]).meterWorkSuggestion.state,"stale");
 assert.equal(replacePoemLines(poem,[]).meterWorkSuggestion.state,"stale");
});
test("raw editor metadata falls back to computed fields and manual still wins",()=>{
 const line={id:"l",text:"строка",meter:"",feet:0,clause:"м",scheme:"",starred:false,breakBefore:false,note:""};
 const poem=completePoem(line,{rawText:true,modified:true,fields:{"метр":"Я","формула":"Я4м","стопность":"4","клаузула":"м"},editorMetadata:{meter:{},formula:{},stopness:{},clausula:"м",rhyme:"",effects:[],strophe:"0",graphicStrophe:"",mode:"auto"}});
 const html=exportPoem(poem);assert.match(html,/@метр Я/);assert.match(html,/@формула Я4м/);assert.match(html,/@стопность 4/);
 assert.match(exportCorpus({id:"c",name:"c",encoding:"utf-8",order:0,eol:"\n"},[poem]),/@формула Я4м/);
 const manual={...poem,editorMetadata:{...poem.editorMetadata,meter:{manual:"Х"}}};assert.match(exportPoem(manual),/@метр Х/);
});
test("page editor integration compares old lines before applying document updates",()=>{
 const line={id:"l",text:"строка",meter:"Я",feet:4,clause:"м",scheme:"",starred:false,breakBefore:false,note:""},work={sourceSignature:"old",state:"pending",warnings:[],metadataSuggestion:{meter:"Я",formula:"Я4м",stopness:"4",sourceSignature:"old",state:"pending",explanation:""}},poem=completePoem(line,{meterWorkSuggestion:work});
 const patch={title:"Новое название",dirty:true,modified:true};
 assert.equal(updatePoemFromEditor(poem,[{...line,text:"правка"}],patch).meterWorkSuggestion.state,"stale");
 assert.equal(updatePoemFromEditor(poem,[line,{...line,id:"new"}],patch).meterWorkSuggestion.state,"stale");
 assert.equal(updatePoemFromEditor(poem,[],patch).meterWorkSuggestion.state,"stale");
 const metadataOnly=updatePoemFromEditor(poem,[line],patch);assert.equal(metadataOnly.meterWorkSuggestion.state,"pending");assert.equal(metadataOnly.title,"Новое название");
 const interpretation=updatePoemFromEditor(poem,[{...line,feet:5}],patch);assert.equal(interpretation.meterWorkSuggestion.state,"stale");
});
