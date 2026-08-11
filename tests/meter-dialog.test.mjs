import test from "node:test";import assert from "node:assert/strict";
import {canBulkAcceptMeter,recoverMeterJob} from "../app/meter-dialog.tsx";
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
