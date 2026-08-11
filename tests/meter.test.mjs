import test from "node:test";import assert from "node:assert/strict";
import {acceptMeterSuggestion,acceptStressSuggestion,acceptStressWord,METER_ANALYZER_VERSION,meterSuggestionIsCurrent,sha256Text} from "../app/corpus.ts";
const candidate={meter:"Я",feetOrIctuses:4,ictusPositions:[1,3,5,7],anacrusis:1,ictusOmissions:[],weakStresses:[],violations:[],regular:true};
const meter=text=>({sourceText:text,sourceHash:sha256Text(text),analyzerVersion:METER_ANALYZER_VERSION,syllables:[],words:[],accentSequence:"0101",candidates:[candidate],selected:candidate,clause:"м",unknownWords:[],explanation:"",quality:"exact",state:"pending",analysedAt:"now",warnings:[]});
const line=text=>({id:"l",text,meter:"",feet:0,clause:"ж",scheme:"imported-scheme",breakBefore:false,starred:false,note:"",meterSuggestion:meter(text)});
test("meter acceptance checks text, hash and version and does not export accent sequence as scheme",()=>{
 const accepted=acceptMeterSuggestion(line("вода`"));assert.equal(accepted.meter,"Я");assert.equal(accepted.feet,4);assert.equal(accepted.scheme,"imported-scheme");
 for(const bad of [{sourceHash:"bad"},{analyzerVersion:"future"},{sourceText:"other"}]){const value=line("вода`");value.meterSuggestion={...value.meterSuggestion,...bad};assert.equal(acceptMeterSuggestion(value).meter,"");assert.equal(meterSuggestionIsCurrent(value),false)}
});
test("accepting a stress line or word makes a prior meter proposal stale",()=>{
 const base=line("погода");base.stressSuggestion={sourceText:"погода",suggestedText:"пого`да",sourceHash:sha256Text("погода"),state:"pending",confidence:1,uncertainWords:[],words:[{original:"погода",normalized:"погода",position:3,confidence:1,alternatives:[],ambiguous:false,source:"dictionary"}],engine:"x",engineVersion:"1",analysedAt:"now"};
 assert.equal(acceptStressSuggestion(base).meterSuggestion.state,"stale");
 assert.equal(acceptStressWord(base,0).meterSuggestion.state,"stale");
});
