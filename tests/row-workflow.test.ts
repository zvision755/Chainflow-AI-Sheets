import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../core/scheduler';
import { rowWorkflow } from '../core/row-workflow';
import { emptyCell, newColumn, type Sheet, type RunOptions } from '../core/types';
import { parseSheet, serialize } from '../core/storage';

const options: RunOptions = { mode: 'api', concurrency: 2, timeout: 1000, totalTimeout: 5000, maxSteps: 50, maxRetries: 0, dependencyDelayMs: 0, autoRetry: false };
function fixture(): Sheet {
  const columns = [newColumn('a', '输入', []), newColumn('b', '节点 B', ['a']), newColumn('c', '节点 C', ['b']), newColumn('d', '节点 D', ['c'])];
  columns.forEach(column => column.prompt = `生成 ${column.id}`);
  return { version: 1, name: '通用工作流', columns, rows: [] };
}
async function finish(engine: Scheduler) {
  const start = Date.now();
  while (engine.busy) { assert.ok(Date.now() - start < 3000); await new Promise(resolve => setTimeout(resolve, 5)); }
}
test('arbitrary starting column preserves manually filled values and leaves empty upstream untouched', async () => {
  for (const start of ['a', 'b', 'c', 'd']) {
    const inputs: string[] = [], sheet = fixture();
    const engine = new Scheduler(sheet, async payload => { inputs.push(payload.input); return { text: `${payload.input}!`, usage: { input: 1, output: 1 } }; });
    const rowId = engine.addRow(undefined, { [start]: '手动来源' });
    const plan = rowWorkflow(sheet, rowId);
    engine.run(plan.targets, options); await finish(engine);
    const startIndex = sheet.columns.findIndex(column => column.id === start);
    assert.equal(inputs.length, 3 - startIndex);
    assert.equal(sheet.rows[0].cells[start].value, '手动来源');
    for (const column of sheet.columns.slice(0, startIndex)) assert.equal(sheet.rows[0].cells[column.id].value, '');
    assert.equal(engine.running, 0); assert.equal(engine.queued, 0);
    assert.deepEqual(plan.blocked, []);
    assert.equal(parseSheet(JSON.parse(serialize(sheet))).rows[0].cells[start].value, '手动来源');
  }
});
test('multi-input branches require every source and preserve simultaneous manual starts', async () => {
  const sheet = fixture(); sheet.columns[2].sources = ['a', 'b'];
  const calls: string[] = [], engine = new Scheduler(sheet, async payload => { calls.push(payload.input); return { text: '合并结果', usage: { input: 1, output: 1 } }; });
  const rowId = engine.addRow(undefined, { b: '独立来源' });
  assert.deepEqual(rowWorkflow(sheet, rowId).targets, []);
  assert.deepEqual(rowWorkflow(sheet, rowId).blocked, ['节点 C', '节点 D']);
  engine.edit(rowId, 'a', '另一来源');
  // Re-enter B after editing A invalidates it, matching the existing scheduler's edit semantics.
  engine.edit(rowId, 'b', '独立来源 2');
  engine.run(rowWorkflow(sheet, rowId).targets, options); await finish(engine);
  assert.equal(calls.length, 2); assert.match(calls[0], /另一来源/); assert.match(calls[0], /独立来源 2/);
  assert.equal(sheet.rows[0].cells.b.value, '独立来源 2');
});
test('three continuous submissions share the queue, preserve IDs, streaming and results despite reordering', async () => {
  const sheet = fixture(); let active = 0, peak = 0;
  const engine = new Scheduler(sheet, async (payload, signal, context) => {
    active++; peak = Math.max(peak, active); context?.onText?.(payload.input + '流式');
    await new Promise(resolve => setTimeout(resolve, 15)); active--;
    return { text: payload.input + '完成', usage: { input: 1, output: 1 } };
  });
  const ids = ['第一句', '第二句', '第三句'].map(value => {
    const rowId = engine.addRow(undefined, { b: value });
    engine.run(rowWorkflow(sheet, rowId).targets, { ...options, streaming: true });
    return rowId;
  });
  engine.moveRow(ids[2], -1); await finish(engine);
  assert.equal(new Set(ids).size, 3); assert.ok(peak <= 2);
  ids.forEach((id, index) => {
    const row = sheet.rows.find(row => row.id === id)!;
    assert.equal(row.cells.d.value, ['第一句', '第二句', '第三句'][index] + '完成完成');
    assert.equal(row.cells.a.value, '');
  });
});
test('seed edit cancels old downstream and late outputs cannot overwrite the newer row state', async () => {
  const sheet = fixture(); let resolve!: (value: { text: string; usage: { input: number; output: number } }) => void;
  const engine = new Scheduler(sheet, async () => new Promise(done => { resolve = done; }));
  const rowId = engine.addRow(undefined, { c: '来源' });
  engine.run(rowWorkflow(sheet, rowId).targets, options); await new Promise(done => setTimeout(done, 5));
  engine.edit(rowId, 'c', '最新来源'); await finish(engine);
  resolve({ text: '旧输出', usage: { input: 1, output: 1 } }); await new Promise(done => setTimeout(done, 5));
  assert.equal(sheet.rows[0].cells.c.value, '最新来源'); assert.equal(sheet.rows[0].cells.d.value, ''); assert.equal(sheet.rows[0].cells.d.status, 'stale');
});
test('creation enforces row limits and accepts independent filled nodes atomically', () => {
  const sheet = fixture(), engine = new Scheduler(sheet, async () => { throw Error('不应调用'); });
  const rowId = engine.addRow(undefined, { a: 'A 内容', c: 'C 内容' });
  assert.equal(sheet.rows[0].cells.c.status, 'done');
  assert.deepEqual(rowWorkflow(sheet, rowId).targets.map(task => task.column), ['b', 'd']);
  assert.throws(() => engine.addRow(undefined, { missing: '文本' }), /录入列/);
  assert.throws(() => engine.addRow(undefined, { a: '字'.repeat(32001) }), /长度/);
  sheet.rows = Array.from({ length: 500 }, (_, i) => ({ id: String(i), cells: { a: emptyCell() } }));
  assert.throws(() => engine.addRow(), /500/);
});
test('upstream completion respects explicit manual boundaries during the same row run', async () => {
  const sheet = fixture(), engine = new Scheduler(sheet, async payload => {
    await new Promise(resolve => setTimeout(resolve, payload.prompt.includes('b') ? 10 : 30));
    return { text: payload.input + '生成', usage: { input: 1, output: 1 } };
  });
  const rowId = engine.addRow(undefined, { a: 'A 来源', c: 'C 手动来源' });
  const workflow = rowWorkflow(sheet, rowId);
  engine.run(workflow.targets, options, false, workflow.sources); await finish(engine);
  const row = sheet.rows[0];
  assert.equal(row.cells.b.value, 'A 来源生成');
  assert.equal(row.cells.c.value, 'C 手动来源'); assert.equal(row.cells.c.status, 'done');
  assert.equal(row.cells.d.value, 'C 手动来源生成'); assert.equal(row.cells.d.status, 'done');
});
test('65 rows: insertion preserves original records/history and advances continuous anchors', () => {
  const sheet=fixture(), engine=new Scheduler(sheet,async()=>{throw Error('not running');});
  const ids=Array.from({length:65},(_,i)=>engine.addRow(undefined,{a:`原第 ${i+1} 行`}));
  sheet.rows[10].cells.b=emptyCell('原输出','done');
  sheet.rows[10].cells.b.history=['旧输出','原输出'];sheet.rows[10].cells.b.historyIndex=1;
  const before=JSON.stringify(sheet.rows), originals=[...sheet.rows];
  let anchor=ids[9];
  const inserted=['備える','続ける','終える'].map((value,index)=>{
    anchor=engine.addRow(undefined,{a:value},anchor);
    if(index===0){assert.equal(sheet.rows.length,66);assert.equal(sheet.rows[10].id,anchor);assert.equal(sheet.rows[11].id,ids[10]);}
    return anchor;
  });
  assert.equal(sheet.rows.length,68);
  assert.deepEqual(sheet.rows.slice(10,13).map(row=>row.id),inserted);
  assert.equal(sheet.rows[13].id,ids[10]);
  assert.equal(JSON.stringify(sheet.rows.filter(row=>ids.includes(row.id))),before);
  originals.forEach(row=>assert.equal(sheet.rows.find(item=>item.id===row.id),row));
  assert.equal(new Set(sheet.rows.map(row=>row.id)).size,68);
  const last=engine.addRow(undefined,{a:'末尾插入'},ids[64]);
  assert.equal(sheet.rows.at(-1)?.id,last);
  const appended=engine.addRow(undefined,{a:'总览追加'});
  assert.equal(sheet.rows.at(-1)?.id,appended);
});
test('stable insertion anchor follows moves and deleted anchor fails without mutating data',()=>{
  const sheet=fixture(),engine=new Scheduler(sheet,async()=>{throw Error('not running');});
  const a=engine.addRow(),b=engine.addRow(),c=engine.addRow();
  engine.moveRow(a,1);
  const inserted=engine.addRow(undefined,{b:'任意列'},a);
  assert.deepEqual(sheet.rows.map(row=>row.id),[b,a,inserted,c]);
  engine.removeRow(a);const before=serialize(sheet);
  assert.throws(()=>engine.addRow(undefined,{a:'保留草稿'},a),/原行已删除/);
  assert.equal(serialize(sheet),before);
});
test('insertion during async generation preserves ID-bound outputs on original and new rows',async()=>{
  const sheet=fixture(),engine=new Scheduler(sheet,async payload=>{
    await new Promise(resolve=>setTimeout(resolve,20));
    return {text:payload.input+'结果',usage:{input:1,output:1}};
  });
  const original=engine.addRow(undefined,{c:'原任务'}),other=engine.addRow(undefined,{c:'后行'});
  engine.run(rowWorkflow(sheet,original).targets,options);
  const inserted=engine.addRow(undefined,{c:'新任务'},original);
  engine.run(rowWorkflow(sheet,inserted).targets,options);
  await finish(engine);
  assert.deepEqual(sheet.rows.map(row=>row.id),[original,inserted,other]);
  assert.equal(sheet.rows.find(row=>row.id===original)!.cells.d.value,'原任务结果');
  assert.equal(sheet.rows.find(row=>row.id===inserted)!.cells.d.value,'新任务结果');
  assert.equal(sheet.rows.find(row=>row.id===other)!.cells.d.value,'');
});
