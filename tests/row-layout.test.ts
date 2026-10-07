import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRowLines, wrappedLineCount } from '../core/row-layout';
import { parseSheet, serialize } from '../core/storage';
import { example } from '../core/types';
import { Scheduler } from '../core/scheduler';

test('output rows grow past four wrapped lines and stop auto-growing at twelve', () => {
  const sheet = example(), row = sheet.rows[0];
  assert.equal(autoRowLines(row, sheet.columns), 4);
  row.cells.teacher.value = '日'.repeat(140);
  assert.ok(autoRowLines(row, sheet.columns) > 4);
  row.cells.teacher.value = '日'.repeat(5000);
  assert.equal(autoRowLines(row, sheet.columns), 12);
  assert.ok(wrappedLineCount('短句\n第二行', 300) >= 2);
});

test('manual row height survives local and JSON persistence, and can return to automatic height', () => {
  const sheet = example(), engine = new Scheduler(sheet, async () => { throw Error('不应调用'); });
  engine.setRowHeight('row-1', 520);
  assert.equal(parseSheet(JSON.parse(serialize(sheet))).rows[0].height, 520);
  engine.setRowHeight('row-1', null);
  assert.equal(sheet.rows[0].height, undefined);
  assert.equal(sheet.rows[0].cells.input.value, 'フレーム');
});
