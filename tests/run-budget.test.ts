import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRunOptions,readRunOptions,writeRunOptions} from '../core/run-settings';
import {Scheduler} from '../core/scheduler';
import {emptyCell,newColumn,type Sheet} from '../core/types';
import {ModelError} from '../model/errors';

test('runtime settings default to three and accept expanded limits without losing saved preferences',()=>{
  assert.equal(defaultRunOptions.concurrency,3);assert.equal(defaultRunOptions.apiMaxRetries,3);
  const settings={...defaultRunOptions,concurrency:10,totalTimeout:3600000,apiMaxRetries:5};
  assert.deepEqual(readRunOptions(writeRunOptions(settings)),settings);
  assert.equal(readRunOptions(writeRunOptions({...settings,concurrency:2}))?.concurrency,2);
  for(const change of [{concurrency:11},{totalTimeout:3660000},{apiMaxRetries:6}])assert.equal(readRunOptions(JSON.stringify({...settings,...change})),null);
});
function fixture(count:number):Sheet{return {version:1,name:'预算',columns:[newColumn('a','输入',[]),{...newColumn('b','输出',['a']),prompt:'生成'}],rows:Array.from({length:count},(_,i)=>({id:'r'+i,cells:{a:emptyCell('输入'+i,'done'),b:emptyCell()}}))};}
async function finish(engine:Scheduler){for(let i=0;engine.busy&&i<1000;i++)await new Promise(r=>setTimeout(r,5));assert.equal(engine.busy,false);}
for(const mode of ['api','agent'] as const){
  test(mode+' allows ten simultaneous jobs and never exceeds configured concurrency',async()=>{
    let active=0,peak=0,calls=0;
    const engine=new Scheduler(fixture(21),async request=>{active++;peak=Math.max(peak,active);calls++;await new Promise(r=>setTimeout(r,30));active--;return {text:request.input+'结果',usage:{input:1,output:1}};});
    engine.run(engine.targets('all'),{...defaultRunOptions,mode,concurrency:10,dependencyDelayMs:0});await finish(engine);
    assert.equal(peak,10);assert.equal(calls,21);assert.ok(engine.sheet.rows.every(row=>row.cells.b.status==='done'));
  });
  test(mode+' retries a temporary failure at most five times',async()=>{
    let calls=0;const engine=new Scheduler(fixture(1),async()=>{calls++;throw new ModelError('暂时断开','network',true);});
    engine.run(engine.targets('all'),{...defaultRunOptions,mode,apiMaxRetries:5,retryDelayMs:10,dependencyDelayMs:0});await finish(engine);
    assert.equal(calls,6);assert.equal(engine.sheet.rows[0].cells.b.status,'error');
  });
}
