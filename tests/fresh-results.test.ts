import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../core/scheduler';
import { example, emptyCell, type GenerateInput, type RunOptions } from '../core/types';
import { parseSheet, serialize } from '../core/storage';
import { freshPrompt, repeatedResult } from '../core/fresh-results';

const options: RunOptions = {mode:'api',concurrency:1,timeout:1000,maxSteps:10,maxRetries:1,totalTimeout:5000,dependencyDelayMs:0,autoRetry:true,apiMaxRetries:3,retryDelayMs:10};
const old = '写真をフレームに入れました。';
const result = (text: string) => ({text,usage:{input:10,output:20}});
function sheet() { const s=example();s.columns[1].freshResults=true;s.rows[0].cells.explain=emptyCell(old,'done');s.rows[0].cells.teacher=emptyCell('旧解释','done');return s; }
async function finish(engine: Scheduler) { const end=Date.now()+3000;while(engine.busy){if(Date.now()>end)throw new Error('stuck');await new Promise(resolve=>setTimeout(resolve,5));} }

test('fresh B reruns call the model each time, exclude past examples, preserve prompts, and invalidate only downstream',async()=>{
  const payloads:GenerateInput[]=[],answers=['新しいフレームを買いました。','フレームが壊れました。','フレームを磨きました。'];
  const e=new Scheduler(sheet(),async payload=>{payloads.push(payload);return result(answers[payloads.length-1]);});
  const prompt=e.sheet.columns[1].prompt;
  for(let i=0;i<3;i++){e.run(e.targets('cell','row-1','explain'),options,true);await finish(e);assert.equal(e.sheet.rows[0].cells.explain.value,answers[i]);}
  assert.equal(payloads.length,3);assert.equal(new Set(payloads.map(p=>p.prompt.split('\n')[0])).size,3);
  assert.ok(payloads.every(p=>p.input==='フレーム'&&p.prompt.includes(prompt)));
  assert.ok(payloads[0].prompt.includes(old));assert.ok(payloads[2].prompt.includes(answers[0])&&payloads[2].prompt.includes(answers[1]));
  assert.equal(e.sheet.columns[1].prompt,prompt);assert.equal(e.sheet.rows[0].cells.teacher.value,'旧解释');assert.equal(e.sheet.rows[0].cells.teacher.status,'stale');assert.equal(e.running,0);assert.equal(e.queued,0);
  const exported=serialize(e.sheet);assert.equal(parseSheet(JSON.parse(exported)).columns[1].freshResults,true);assert.ok(!exported.includes('内部请求标记'));assert.ok(!exported.includes(old));
});

test('same result retries only when necessary with a new marker, and usage includes both calls',async()=>{
  const prompts:string[]=[];const e=new Scheduler(sheet(),async p=>{prompts.push(p.prompt);return result(prompts.length===1?' 写真をフレームに入れました！ ':'フレームの色が気に入りました。');});
  e.run(e.targets('cell','row-1','explain'),options,true);await finish(e);
  assert.equal(prompts.length,2);assert.notEqual(prompts[0].split('\n')[0],prompts[1].split('\n')[0]);assert.equal(e.sheet.rows[0].cells.explain.status,'done');assert.deepEqual(e.sheet.rows[0].cells.explain.usage,{input:20,output:40});assert.equal(e.running,0);
});

test('repeated outputs stop after one extra call, preserve old output, and obey retry switch',async()=>{
  for(const autoRetry of [true,false]){let calls=0;const e=new Scheduler(sheet(),async()=>{calls++;return result(old);});e.run(e.targets('cell','row-1','explain'),{...options,autoRetry},true);await finish(e);
    assert.equal(calls,autoRetry?2:1);assert.equal(e.sheet.rows[0].cells.explain.value,old);assert.equal(e.sheet.rows[0].cells.explain.status,'error');assert.match(e.sheet.rows[0].cells.explain.error!,/相同/);assert.equal(e.sheet.rows[0].cells.teacher.status,'done');assert.equal(e.running,0);assert.equal(e.queued,0);
  }
});

test('new prompt stays bounded, changes even within the same second, and detects formatting-only differences',()=>{
  const now=new Date('2026-10-06T01:02:03.123Z');const a=freshPrompt('原任务',[old],'request-a',now),b=freshPrompt('原任务',[old],'request-b',now);
  assert.ok(a.startsWith('[内部请求标记：2026-10-06T01:02:03Z'));assert.notEqual(a,b);assert.ok(repeatedResult('写真をフレームに入れました!', [old]));
  assert.ok(freshPrompt('长'.repeat(11000),['旧'.repeat(32000)],'a',now).length<=12000);assert.throws(()=>freshPrompt('长'.repeat(11990),[],'a',now),/提示词过长/);
});

test('Agent B rerun shares fresh-result logic without extra semantic calls or exceeding step budget',async()=>{
  let calls=0;const e=new Scheduler(sheet(),async p=>{calls++;assert.ok(p.prompt.startsWith('[内部请求标记：'));assert.ok(p.prompt.includes(old));return result('このフレームは丈夫です。');});
  e.run(e.targets('cell','row-1','explain'),{...options,mode:'agent',maxSteps:1},true);await finish(e);assert.equal(calls,1);assert.equal(e.sheet.rows[0].cells.explain.status,'done');assert.equal(e.running,0);
});

test('stop during repeated-output cooldown cancels the pending extra request',async()=>{
  let calls=0;const e=new Scheduler(sheet(),async()=>{calls++;return result(old);});e.run(e.targets('cell','row-1','explain'),{...options,retryDelayMs:1000},true);
  for(let i=0;i<30&&!e.queued;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(e.queued,1);e.stop();await finish(e);assert.equal(calls,1);assert.equal(e.sheet.rows[0].cells.explain.status,'cancelled');assert.equal(e.sheet.rows[0].cells.explain.value,old);assert.equal(e.queued,0);
});
