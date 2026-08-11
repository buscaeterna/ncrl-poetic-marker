import test from "node:test";import assert from "node:assert/strict";
import {applyWorkMetadata,canBulkAcceptMeter,poemMeterSignature,recoverMeterJob,restoreWorkMetadata,validateManualLine} from "../app/meter-dialog.tsx";
import {METER_ANALYZER_VERSION,sha256Text} from "../app/corpus.ts";
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
 const stale={...poem,meterWorkSuggestion:{...poem.meterWorkSuggestion,state:"stale"}};assert.equal(applyWorkMetadata(stale,"meter"),stale);
});
