import test from 'node:test';
import assert from 'node:assert/strict';
import { activeTable, addTable, initialWorkspace, restoreWorkspace, saveActive, selectTable, serializeWorkspace } from '../core/workspace';
import { savedExample, savedExampleOptions } from '../core/example-workflow';
import { defaultRunOptions } from '../core/run-settings';
import { serialize } from '../core/storage';
test('first visit is a neutral blank table without Japanese prompts or outputs',()=>{
 const workspace=restoreWorkspace(null,null,null),sheet=activeTable(workspace).sheet;
 assert.equal(sheet.name,'未命名表格');assert.equal(sheet.rows.length,1);assert.equal(sheet.columns.length,2);
 assert.ok(sheet.columns.every(c=>c.prompt===''&&c.ttsLanguage==='off'));assert.ok(Object.values(sheet.rows[0].cells).every(c=>c.value===''));
});
test('multiple tables retain edits, histories, names, layout and independent run settings after switch and refresh',()=>{
 let workspace=initialWorkspace();const first=activeTable(workspace);first.sheet.name='业务数据';first.sheet.rows[0].cells.input.value='客户';first.sheet.rows[0].height=500;
 workspace=saveActive(workspace,first.sheet,{...defaultRunOptions,concurrency:3});
 workspace=addTable(workspace,savedExample(),savedExampleOptions());const secondId=workspace.activeId;
 assert.equal(workspace.tables.length,2);assert.equal(activeTable(workspace).sheet.name,'日语词汇学习');assert.equal(activeTable(workspace).options.concurrency,3);
 workspace=selectTable(workspace,first.id);assert.equal(activeTable(workspace).sheet.rows[0].cells.input.value,'客户');
 workspace=restoreWorkspace(serializeWorkspace(workspace),null,null);assert.equal(activeTable(workspace).sheet.name,'业务数据');assert.equal(activeTable(workspace).sheet.rows[0].height,500);assert.equal(activeTable(workspace).options.concurrency,3);
 workspace=selectTable(workspace,secondId);assert.equal(activeTable(workspace).sheet.rows[1].cells.explain.history?.length,2);
});
test('loading example twice adds independent tables and never replaces the original',()=>{
 let workspace=initialWorkspace();workspace=addTable(workspace,savedExample(),savedExampleOptions());workspace=addTable(workspace,savedExample(),savedExampleOptions());assert.equal(workspace.tables.length,3);
 workspace.tables[1].sheet.rows[0].cells.input.value='edited';assert.equal(workspace.tables[2].sheet.rows[0].cells.input.value,'フレーム');assert.equal(workspace.tables[0].sheet.rows[0].cells.input.value,'');
});
test('old single-sheet storage migrates without losing prompts, outputs or settings; new workspace takes precedence',()=>{
 const old=savedExample();const options={...defaultRunOptions,concurrency:1};const migrated=restoreWorkspace(null,serialize(old),JSON.stringify(options));assert.equal(activeTable(migrated).sheet.rows.length,3);assert.equal(activeTable(migrated).options.concurrency,1);
 const restored=restoreWorkspace(serializeWorkspace(initialWorkspace()),serialize(old),JSON.stringify(options));assert.equal(activeTable(restored).sheet.name,'未命名表格');
});
test('workspace exports exclude credentials and runtime metadata and reject invalid selection or corrupt storage',()=>{
 const workspace=addTable(initialWorkspace(),savedExample());(workspace as any).key='secret';(activeTable(workspace).sheet as any).key='secret';(activeTable(workspace).options as any).key='secret';assert.ok(!serializeWorkspace(workspace).includes('secret'));
 assert.throws(()=>selectTable(workspace,'missing'));assert.throws(()=>restoreWorkspace('{broken',null,null));assert.throws(()=>restoreWorkspace(JSON.stringify({...workspace,activeId:'missing'}),null,null));assert.throws(()=>restoreWorkspace(JSON.stringify({...workspace,tables:[workspace.tables[0],workspace.tables[0]]}),null,null));
});
import { workbookCsv, importWorkbook } from '../core/workspace';
test('workbook JSON round-trips all sheets and imports them without replacing the current workbook',()=>{
 const original=initialWorkspace();original.tables[0].sheet.name='客户表';original.tables[0].sheet.rows[0].cells.input.value='客户数据';
 const workspace=addTable(original,savedExample(),savedExampleOptions());
 const serialized=serializeWorkspace(workspace),restored=restoreWorkspace(serialized,null,null);assert.equal(restored.tables.length,2);assert.equal(restored.tables[0].sheet.rows[0].cells.input.value,'客户数据');
 const imported=importWorkbook(initialWorkspace(),JSON.parse(serialized));assert.equal(imported.tables.length,3);assert.equal(imported.tables[0].sheet.name,'未命名表格');assert.equal(activeTable(imported).sheet.name,'日语词汇学习');assert.equal(new Set(imported.tables.map(t=>t.id)).size,3);
 const legacy=importWorkbook(initialWorkspace(),JSON.parse(serialize(savedExample())));assert.equal(legacy.tables.length,2);assert.equal(activeTable(legacy).sheet.rows.length,3);
});
test('workbook CSV includes every sheet and safely quotes variable columns, multiline content and formulas',()=>{
 const first=initialWorkspace();first.tables[0].sheet.name='业务,"表';first.tables[0].sheet.rows[0].cells.input.value='=danger';
 const workspace=addTable(first,savedExample());const csv=workbookCsv(workspace);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"工作表","行号"'));assert.ok(csv.includes('"业务,""表"'));assert.ok(csv.includes('"\'=danger"'));assert.ok(csv.includes('"日语词汇学习","3"'));assert.ok(csv.includes('説明書を読んでも直せなかった'));assert.ok(csv.includes('"C 列名称","C 列内容"'));
});
import { removeTable, restoreTable } from '../core/workspace';
test('deleting active worksheet selects a neighbour, preserves other worksheets and permits undo',()=>{
 let workspace=addTable(initialWorkspace(),savedExample());const deleted=activeTable(workspace),index=1;const other=workspace.tables[0];
 workspace=removeTable(workspace,deleted.id);assert.equal(workspace.tables.length,1);assert.equal(workspace.activeId,other.id);assert.deepEqual(workspace.tables[0],other);
 const restored=restoreTable(workspace,deleted,index);assert.equal(restored.tables.length,2);assert.equal(restored.activeId,deleted.id);assert.deepEqual(restored.tables[1],deleted);
 assert.equal(restoreWorkspace(serializeWorkspace(workspace),null,null).tables.length,1);assert.throws(()=>removeTable(workspace,'missing'));
});
test('deleting last worksheet creates neutral blank worksheet, deleting inactive preserves active selection',()=>{
 const first=initialWorkspace();const lastRemoved=removeTable(first,first.activeId);assert.equal(lastRemoved.tables.length,1);assert.notEqual(lastRemoved.activeId,first.activeId);assert.equal(activeTable(lastRemoved).sheet.name,'未命名表格');assert.equal(activeTable(lastRemoved).sheet.rows[0].cells.input.value,'');
 const multiple=addTable(first,savedExample());const removed=removeTable(multiple,first.activeId);assert.equal(removed.activeId,multiple.activeId);assert.equal(activeTable(removed).sheet.name,'日语词汇学习');
});
