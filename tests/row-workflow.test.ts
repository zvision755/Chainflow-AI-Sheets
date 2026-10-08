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
