import test from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler} from '../core/scheduler';
import {example,emptyCell,newColumn,type RunOptions} from '../core/types';
import {parseSheet,serialize} from '../core/storage';
const opt:RunOptions={mode:'api',concurrency:3,timeout:1000,maxSteps:20,maxRetries:0,totalTimeout:5000,dependencyDelayMs:0,autoRetry:false};
async function finish(e:Scheduler){while(e.busy)await new Promise(r=>setTimeout(r,5));}
test('any column can be manual with blank prompts and preserve content/history across storage',()=>{
 const sheet=example(),column=sheet.columns[2];sheet.rows[0].cells[column.id]= {...emptyCell('手填单词','done'),history:['旧结果','手填单词'],historyIndex:1};
 const e=new Scheduler(sheet,async()=>{throw Error('manual must not generate');});
 e.configure({...column,sources:[],prompt:'',userPrompt:''});
 const restored=parseSheet(JSON.parse(serialize(e.sheet)));
 assert.equal(restored.columns[2].prompt,'');assert.deepEqual(restored.columns[2].sources,[]);
 assert.deepEqual(restored.rows[0].cells[column.id].history,['旧结果','手填单词']);assert.equal(restored.rows[0].cells[column.id].value,'手填单词');
 assert.equal(restored.rows[0].cells[column.id].status,'done');assert.equal(e.targets('column',undefined,column.id).length,0);
});
test('A generates from manual C, source edits invalidate A and cycles fail without mutations',async()=>{
 const sheet=example();sheet.columns=[newColumn('a','A',['c']),newColumn('b','B',['a']),newColumn('c','C',[])];sheet.columns[0].prompt='解释';sheet.columns[1].prompt='分析';
 sheet.rows=[{id:'stable-row',cells:{a:emptyCell(),b:emptyCell(),c:emptyCell('備える','done')}}];
 const inputs:string[]=[];const e=new Scheduler(parseSheet(JSON.parse(serialize(sheet))),async p=>{inputs.push(p.input);return {text:p.input+'结果',usage:{input:1,output:1}};});
 e.run(e.targets('all'),opt);await finish(e);assert.deepEqual(inputs,['備える','備える结果']);
 assert.equal(e.sheet.rows[0].cells.c.value,'備える');
 assert.throws(()=>e.configure({...e.sheet.columns[2],sources:['a'],prompt:'循环'}),/循环/);assert.deepEqual(e.sheet.columns[2].sources,[]);
 e.edit('stable-row','c','新词');assert.equal(e.sheet.rows[0].cells.a.status,'stale');assert.equal(e.sheet.rows[0].cells.b.status,'stale');
 e.moveColumn('a',1);e.moveColumn('c',-1);const restored=parseSheet(JSON.parse(serialize(e.sheet)));assert.deepEqual(restored.columns.find(c=>c.id==='a')?.sources,['c']);
});
test('switching a running generation column to manual rejects late output and preserves saved history',async()=>{
 const sheet=example();let resolve!:(v:{text:string;usage:{input:number;output:number}})=>void;
 const c=sheet.rows[0].cells.explain;c.value='已存结果';c.history=['已存结果'];
 const e=new Scheduler(sheet,async()=>new Promise(r=>resolve=r));e.run(e.targets('cell','row-1','explain'),opt,true);
 await new Promise(r=>setTimeout(r,5));e.configure({...e.sheet.columns[1],sources:[],prompt:''});await finish(e);
 resolve({text:'过期结果',usage:{input:1,output:1}});await new Promise(r=>setTimeout(r,5));
 assert.equal(c.value,'已存结果');assert.deepEqual(c.history,['已存结果']);assert.equal(c.status,'done');
});
import {displaySourceReferences,bindSourceReferences} from '../core/prompt-templates';
import {appendImportedRows} from '../core/bulk-import';
test('letter templates display without IDs, bind typed lowercase letters, survive rename and reorder',()=>{
 const sheet=example();const visible='语境：{{source:A}}\n单词：{{source:c}}';
 const bound=bindSourceReferences(visible,sheet);
 assert.equal(bound,'语境：{{source:input}}\n单词：{{source:teacher}}');
 assert.equal(displaySourceReferences(bound,sheet),'语境：{{source:A}}\n单词：{{source:C}}');
 sheet.columns[0].name='改名';assert.equal(displaySourceReferences(bound,sheet),'语境：{{source:A}}\n单词：{{source:C}}');
 [sheet.columns[0],sheet.columns[2]]=[sheet.columns[2],sheet.columns[0]];
 assert.equal(displaySourceReferences(bound,sheet),'语境：{{source:C}}\n单词：{{source:A}}');assert.equal(bindSourceReferences(displaySourceReferences(bound,sheet),sheet),bound);
 assert.equal(bindSourceReferences('{{source:ZZ}}',sheet),'{{source:ZZ}}');
});
test('split imports still fill first column even when it is a generation column',()=>{
 const sheet=example();sheet.columns[2].sources=[];sheet.columns[0].sources=['teacher'];sheet.rows=[];
 const result=appendImportedRows(sheet,['导入A']);assert.equal(result.rows[0].cells.input.value,'导入A');assert.equal(result.rows[0].cells.teacher.value,'');assert.equal(result.rows[0].cells.input.status,'done');
});
