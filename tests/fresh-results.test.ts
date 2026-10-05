import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../core/scheduler';
import { example, emptyCell, type GenerateInput, type RunOptions } from '../core/types';
import { parseSheet, serialize } from '../core/storage';
import { repeatedResult } from '../core/fresh-results';
import { buildPrompts, promptContext } from '../core/prompt-templates';

const options: RunOptions = {mode:'api',concurrency:1,timeout:1000,maxSteps:10,maxRetries:1,totalTimeout:5000,dependencyDelayMs:0,autoRetry:true,apiMaxRetries:3,retryDelayMs:10};
const old = '写真をフレームに入れました。';
const result = (text: string) => ({text,usage:{input:10,output:20}});
function sheet() { const s=example();s.columns[1].freshResults=true;s.rows[0].cells.explain=emptyCell(old,'done');s.rows[0].cells.teacher=emptyCell('旧解释','done');return s; }
async function finish(engine: Scheduler) { const end=Date.now()+3000;while(engine.busy){if(Date.now()>end)throw new Error('stuck');await new Promise(resolve=>setTimeout(resolve,5));} }

test('B reruns use exact configured messages even with duplicate checks enabled; history is never injected',async()=>{
  const payloads:GenerateInput[]=[],answers=['新しいフレームを買いました。','フレームが壊れました。','フレームを磨きました。'];
  const e=new Scheduler(sheet(),async payload=>{payloads.push(payload);return result(answers[payloads.length-1]);});
  const prompt=e.sheet.columns[1].prompt;
  for(let i=0;i<3;i++){e.run(e.targets('cell','row-1','explain'),options,true);await finish(e);assert.equal(e.sheet.rows[0].cells.explain.value,answers[i]);}
  assert.equal(payloads.length,3);assert.ok(payloads.every(p=>p.input==='フレーム'&&p.prompt===prompt));
  assert.equal(e.sheet.columns[1].prompt,prompt);assert.equal(e.sheet.rows[0].cells.teacher.value,'旧解释');assert.equal(e.sheet.rows[0].cells.teacher.status,'stale');assert.equal(e.running,0);assert.equal(e.queued,0);
  const exported=serialize(e.sheet);assert.equal(parseSheet(JSON.parse(exported)).columns[1].freshResults,true);assert.ok(!exported.includes('内部请求标记'));assert.ok(!exported.includes(old));
});

test('same result retries only when necessary without modifying messages, and usage includes both calls',async()=>{
  const payloads:GenerateInput[]=[];const e=new Scheduler(sheet(),async p=>{payloads.push(p);return result(payloads.length===1?' 写真をフレームに入れました！ ':'フレームの色が気に入りました。');});
  e.run(e.targets('cell','row-1','explain'),options,true);await finish(e);
  assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);assert.equal(e.sheet.rows[0].cells.explain.status,'done');assert.deepEqual(e.sheet.rows[0].cells.explain.usage,{input:20,output:40});assert.equal(e.running,0);
});

test('repeated outputs stop after one extra call, preserve old output, and obey retry switch',async()=>{
  for(const autoRetry of [true,false]){let calls=0;const e=new Scheduler(sheet(),async()=>{calls++;return result(old);});e.run(e.targets('cell','row-1','explain'),{...options,autoRetry},true);await finish(e);
    assert.equal(calls,autoRetry?2:1);assert.equal(e.sheet.rows[0].cells.explain.value,old);assert.equal(e.sheet.rows[0].cells.explain.status,'error');assert.match(e.sheet.rows[0].cells.explain.error!,/相同/);assert.equal(e.sheet.rows[0].cells.teacher.status,'done');assert.equal(e.running,0);assert.equal(e.queued,0);
  }
});

test('optional time and ID are expanded only where requested; full-size system prompt needs no decoration budget',()=>{
  const s=sheet(),col=s.columns[1],now=new Date('2026-10-06T01:02:03.123Z');col.prompt='任'.repeat(12000);col.userPrompt='{{text}}\n{{timestamp}}\n{{request_id}}';
  const a=buildPrompts(col,promptContext(s,'row-1',col,[old],now,'request-a')),b=buildPrompts(col,promptContext(s,'row-1',col,[old],now,'request-b'));
  assert.equal(a.prompt,col.prompt);assert.equal(b.prompt,col.prompt);assert.equal(a.input,'フレーム\n2026-10-06T01:02:03Z\nrequest-a');assert.notEqual(a.input,b.input);assert.ok(!a.input.includes(old));assert.ok(repeatedResult('写真をフレームに入れました!', [old]));
});

test('Agent B uses the exact system and user prompts without extra semantic calls or hidden history',async()=>{
  const s=sheet();let calls=0;const e=new Scheduler(s,async p=>{calls++;assert.equal(p.prompt,s.columns[1].prompt);assert.equal(p.input,'フレーム');return result('このフレームは丈夫です。');});
  e.run(e.targets('cell','row-1','explain'),{...options,mode:'agent',maxSteps:1},true);await finish(e);assert.equal(calls,1);assert.equal(e.sheet.rows[0].cells.explain.status,'done');assert.equal(e.running,0);
});

test('stop during repeated-output cooldown cancels the pending extra request',async()=>{
  let calls=0;const e=new Scheduler(sheet(),async()=>{calls++;return result(old);});e.run(e.targets('cell','row-1','explain'),{...options,retryDelayMs:1000},true);
  for(let i=0;i<30&&!e.queued;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(e.queued,1);e.stop();await finish(e);assert.equal(calls,1);assert.equal(e.sheet.rows[0].cells.explain.status,'cancelled');assert.equal(e.sheet.rows[0].cells.explain.value,old);assert.equal(e.queued,0);
});
