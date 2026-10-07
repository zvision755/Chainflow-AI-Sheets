import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../core/scheduler';
import { example, type GenerateInput, type RunOptions } from '../core/types';
import { parseSheet, serialize } from '../core/storage';
import { buildPrompts, promptContext } from '../core/prompt-templates';

const options:RunOptions={mode:'api',concurrency:1,timeout:1000,totalTimeout:3000,maxSteps:20,maxRetries:0,dependencyDelayMs:0,autoRetry:false};
async function finish(engine:Scheduler){const end=Date.now()+2000;while(engine.busy){assert.ok(Date.now()<end);await new Promise(resolve=>setTimeout(resolve,5));}}

test('ten successful results persist across reload and all are sent only by the explicit existing-result template',async()=>{
  const sheet=example(),sent:GenerateInput[]=[];
  sheet.columns[1].userPrompt='{{text}}\n已有结果：{{existing_result}}';
  const engine=new Scheduler(sheet,async input=>{sent.push(input);return {text:`例句 ${sent.length}`,usage:{input:1,output:2}};});
  for(let i=0;i<12;i++){engine.run(engine.targets('cell','row-1','explain'),options,true);await finish(engine);}
  assert.equal(engine.recentResults('row-1','explain').length,10);
  assert.deepEqual(engine.recentResults('row-1','explain'),Array.from({length:10},(_,i)=>`例句 ${i+3}`));
  assert.ok(sent[2].input.includes('1. 例句 1\n\n2. 例句 2'));
  assert.ok(sent.every(input=>input.prompt===sheet.columns[1].prompt));
  const restored=parseSheet(JSON.parse(serialize(sheet)));
  const preview=promptContext(restored,'row-1',restored.columns[1]);
  assert.ok(preview.existing_result.includes('例句 3')&&preview.existing_result.includes('例句 12'));
  assert.deepEqual(JSON.parse(preview.recent_results),['例句 8','例句 9','例句 10','例句 11','例句 12']);
  assert.equal(restored.columns[1].historyLimit,10);
  assert.equal(buildPrompts({...restored.columns[1],userPrompt:'{{text}}'},preview).input,'フレーム');
});

test('history navigation makes the selected output the downstream source without another model call',async()=>{
  const sheet=example();let calls=0;
  const engine=new Scheduler(sheet,async()=>({text:`结果 ${++calls}`,usage:{input:1,output:2}}));
  for(let i=0;i<3;i++){engine.run(engine.targets('cell','row-1','explain'),options,true);await finish(engine);}
  sheet.rows[0].cells.teacher.status='done';
  engine.selectHistory('row-1','explain',0);
  assert.equal(sheet.rows[0].cells.explain.value,'结果 1');
  assert.equal(sheet.rows[0].cells.teacher.status,'stale');
  assert.equal(promptContext(sheet,'row-1',sheet.columns[2]).text,'结果 1');
  assert.equal(calls,3);
  const restored=parseSheet(JSON.parse(serialize(sheet)));
  assert.equal(restored.rows[0].cells.explain.historyIndex,0);
  engine.run(engine.targets('cell','row-1','explain'),options,true);await finish(engine);
  assert.deepEqual(engine.recentResults('row-1','explain'),['结果 1','结果 2','结果 3','结果 4']);
  assert.equal(sheet.rows[0].cells.explain.historyIndex,3);
});

test('lowering history capacity trims oldest results, increasing it preserves records and does not schedule generation',()=>{
  const sheet=example(),cell=sheet.rows[0].cells.explain;
  cell.history=['第一条','第二条','第三条','第四条'];cell.value='第一条';cell.historyIndex=0;cell.status='done';
  const engine=new Scheduler(sheet,async()=>{throw Error('不应调用');});
  engine.configure({...sheet.columns[1],historyLimit:2});
  assert.deepEqual(engine.recentResults('row-1','explain'),['第三条','第四条']);
  assert.equal(cell.value,'第四条');
  engine.configure({...sheet.columns[1],historyLimit:20});
  assert.deepEqual(engine.recentResults('row-1','explain'),['第三条','第四条']);
  assert.equal(engine.running,0);assert.equal(engine.queued,0);
  assert.throws(()=>engine.configure({...sheet.columns[1],historyLimit:0}),/1–100/);
});

test('failed and partial results never replace saved history; old worksheets migrate their current result',async()=>{
  const sheet=example();sheet.rows[0].cells.explain.value='已保存结果';sheet.rows[0].cells.explain.status='done';
  const engine=new Scheduler(sheet,async(_input,_signal,context)=>{context?.onText?.('未完成片段');throw Error('模拟失败');});
  engine.run(engine.targets('cell','row-1','explain'),options,true);await finish(engine);
  assert.deepEqual(engine.recentResults('row-1','explain'),['已保存结果']);
  const restored=parseSheet(JSON.parse(serialize(sheet)));
  assert.deepEqual(restored.rows[0].cells.explain.history,['已保存结果']);
  assert.ok(!serialize(sheet).includes('未完成片段'));
});
