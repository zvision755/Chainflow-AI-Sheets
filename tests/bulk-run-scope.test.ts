import test from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler} from '../core/scheduler';
import {emptyCell,newColumn,type Sheet} from '../core/types';
import {defaultRunOptions} from '../core/run-settings';
function fixture():Sheet{return {version:1,name:'范围',columns:[newColumn('a','输入',[]),{...newColumn('b','B',['a']),prompt:'生成 B'},{...newColumn('c','C',['b']),prompt:'生成 C'}],rows:[{id:'r',cells:{a:emptyCell('输入','done'),b:{...emptyCell('保留 B','stale'),history:['旧 B','保留 B'],historyIndex:1},c:emptyCell()}}]};}
async function finish(engine:Scheduler){for(let i=0;engine.busy&&i<500;i++)await new Promise(r=>setTimeout(r,5));assert.equal(engine.busy,false);}
test('missing scope reuses stale upstream text without changing its status, history or value',async()=>{
  const sheet=fixture(),calls:string[]=[],engine=new Scheduler(sheet,async request=>{calls.push(request.input);return {text:'新 C',usage:{input:1,output:1}};});
  const before=structuredClone(sheet.rows[0].cells.b);
  assert.equal(engine.estimate(engine.targets('all'),false,true),1);
  assert.equal(engine.estimate(engine.targets('all')),2);
  engine.run(engine.targets('all'),{...defaultRunOptions,dependencyDelayMs:0},false,[],true);
  await finish(engine);assert.deepEqual(calls,['保留 B']);assert.deepEqual(sheet.rows[0].cells.b,before);assert.equal(sheet.rows[0].cells.c.value,'新 C');
});
test('pending scope regenerates stale content using the unchanged dependency workflow',async()=>{
  const sheet=fixture(),calls:string[]=[],engine=new Scheduler(sheet,async request=>{calls.push(request.input);return {text:request.input+'生成',usage:{input:1,output:1}};});
  engine.run(engine.targets('all'),{...defaultRunOptions,dependencyDelayMs:0});await finish(engine);
  assert.deepEqual(calls,['输入','输入生成']);assert.equal(sheet.rows[0].cells.b.status,'done');
});
test('missing scope counts empty done cells and preserves nonempty downstream across generation',async()=>{
  const sheet=fixture();sheet.rows[0].cells.b=emptyCell('','done');sheet.rows[0].cells.c=emptyCell('保留下游','stale');
  const engine=new Scheduler(sheet,async()=>({text:'新 B',usage:{input:1,output:1}}));
  assert.equal(engine.estimate(engine.targets('all'),false,true),1);
  engine.run(engine.targets('all'),{...defaultRunOptions,dependencyDelayMs:0},false,[],true);await finish(engine);
  assert.equal(sheet.rows[0].cells.c.value,'保留下游');assert.equal(sheet.rows[0].cells.c.status,'stale');
});
test('mark column done changes every nonempty status, preserves history and downstream status',()=>{
  const sheet=fixture();sheet.rows.push({id:'empty',cells:{a:emptyCell(),b:emptyCell('','stale'),c:emptyCell()}},{id:'error',cells:{a:emptyCell(),b:emptyCell('旧失败内容','error'),c:emptyCell()}});
  const engine=new Scheduler(sheet,async()=>{throw Error('should not generate');}),before=structuredClone(sheet.rows[0].cells.b);
  for(const status of ['cancelled','idle','queued','running'] as const)sheet.rows.push({id:status,cells:{a:emptyCell(),b:{...emptyCell('原文',status),history:['旧结果'],error:'旧错误',preview:'临时文字'},c:emptyCell()}});
  assert.equal(engine.markColumnDone('b'),6);
  assert.deepEqual(sheet.rows[0].cells.b,{...before,status:'done'});assert.equal(sheet.rows[1].cells.b.status,'stale');assert.equal(sheet.rows[2].cells.b.status,'done');assert.equal(sheet.rows[0].cells.c.status,'idle');
  for(const row of sheet.rows.slice(3)){assert.equal(row.cells.b.status,'done');assert.equal(row.cells.b.value,'原文');assert.deepEqual(row.cells.b.history,['旧结果']);assert.equal(row.cells.b.error,undefined);assert.equal(row.cells.b.preview,undefined);}
  assert.equal(engine.markColumnDone('b'),0);assert.throws(()=>engine.markColumnDone('missing'),/列不存在/);
});
