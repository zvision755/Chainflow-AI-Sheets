import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImportedRows, undoImportedRows, importCapacity } from '../core/bulk-import';
import {parseSheet,serialize} from '../core/storage';
import { Scheduler } from '../core/scheduler';
import { emptyCell, newColumn, type Sheet } from '../core/types';
import { splitLongText } from '../core/text-segmenter';
function fixture():Sheet {return {version:1,name:'test',columns:[newColumn('a','输入',[]),newColumn('b','结果',['a'])],rows:[{id:'existing',cells:{a:emptyCell('保留','done'),b:{...emptyCell('已有结果','done'),history:['旧结果','已有结果'],historyIndex:1}}}]};}
test('TXT punctuation splitting preserves sentence boundaries and punctuation runs',()=>{
  assert.deepEqual(splitLongText('備える。どうする？行こう！\nHello. Next?!',{delimiters:'。！？!?…．.',splitLines:true,keepDelimiter:true}),['備える。','どうする？','行こう！','Hello.','Next?!']);
});
test('undo removes only imported IDs and preserves unrelated edits and later additions',()=>{
  const original=fixture(), imported=prepareImportedRows(original,['一句','二句']);
  const engine=new Scheduler(imported.sheet,async()=>{throw Error('not used');});
  engine.edit('existing','a','后来编辑');const added=engine.addRow(undefined,{a:'后来新增'});
  engine.setRows(undoImportedRows(engine.sheet,imported.undo));
  assert.deepEqual(engine.sheet.rows.map(row=>row.id),['existing',added]);
  assert.equal(engine.sheet.rows[0].cells.a.value,'后来编辑');
  assert.deepEqual(engine.sheet.rows[0].cells.b.history,['旧结果','已有结果']);
});
test('undo refuses changed/generated/deleted imported rows atomically',()=>{
  for(const action of ['edit','generate','delete']){
    const imported=prepareImportedRows(fixture(),['一句','二句']);const row=imported.sheet.rows[1];
    if(action==='edit')row.cells.a.value='later';
    if(action==='generate')row.cells.b={...emptyCell('generated','done'),history:['generated']};
    if(action==='delete')imported.sheet.rows.splice(1,1);
    const before=JSON.stringify(imported.sheet);
    assert.throws(()=>undoImportedRows(imported.sheet,imported.undo),/无法安全撤销/);
    assert.equal(JSON.stringify(imported.sheet),before);
  }
});
test('undo restores reused blank row and never reuses empty cells with historical data',()=>{
  const sheet=fixture();sheet.rows[0].cells={a:emptyCell(),b:emptyCell()};
  const imported=prepareImportedRows(sheet,['一','二']);assert.equal(imported.sheet.rows.length,2);
  assert.deepEqual(undoImportedRows(imported.sheet,imported.undo),sheet.rows);
  sheet.rows[0].cells.b.history=['要保留的历史'];
  assert.equal(prepareImportedRows(sheet,['一']).sheet.rows.length,2);
});
test('clear column removes content/history but retains IDs, configuration and downstream outputs',()=>{
  const sheet=fixture(),engine=new Scheduler(sheet,async()=>{throw Error('not used');});
  const columns=JSON.stringify(sheet.columns),revision=sheet.rows[0].cells.a.revision;
  engine.clearColumn('a');
  assert.equal(sheet.rows[0].id,'existing');assert.equal(sheet.rows.length,1);assert.equal(JSON.stringify(sheet.columns),columns);
  assert.equal(sheet.rows[0].cells.a.value,'');assert.equal(sheet.rows[0].cells.a.history,undefined);
  assert.ok(sheet.rows[0].cells.a.revision>revision);
  assert.equal(sheet.rows[0].cells.b.value,'已有结果');assert.equal(sheet.rows[0].cells.b.status,'stale');
  engine.clearColumn('b');assert.equal(sheet.rows[0].cells.b.history,undefined);assert.equal(sheet.rows[0].cells.b.value,'');
  assert.throws(()=>engine.clearColumn('missing'),/列不存在/);
});
test('197 cleared rows are reused by 455 entries, resulting in 455 rows, with full undo',()=>{
  const sheet=fixture();sheet.rows=Array.from({length:197},(_,index)=>({id:`blank-${index}`,cells:{a:emptyCell(),b:emptyCell('', 'stale')}}));
  const original=structuredClone(sheet.rows),values=Array.from({length:455},(_,index)=>`句子 ${index+1}`);
  const imported=prepareImportedRows(sheet,values);
  assert.equal(imported.sheet.rows.length,455);
  assert.deepEqual(imported.sheet.rows.map(row=>row.cells.a.value),values);
  assert.deepEqual(imported.sheet.rows.slice(0,197).map(row=>row.id),original.map(row=>row.id));
  assert.deepEqual(undoImportedRows(imported.sheet,imported.undo),original);
});
test('2500 rows survive storage; overflow refuses the entire import and preserves occupied rows',()=>{
  const sheet=fixture();sheet.rows=Array.from({length:2400},(_,i)=>({id:`row-${i}`,cells:{a:emptyCell(`第${i}条`,'done'),b:emptyCell()}}));
  const original=JSON.stringify(sheet);
  assert.equal(importCapacity(sheet),100);
  assert.throws(()=>prepareImportedRows(sheet,Array.from({length:101},()=> '内容')),/未导入任何内容/);
  assert.equal(JSON.stringify(sheet),original);
  const imported=prepareImportedRows(sheet,Array.from({length:100},()=> '内容'));
  assert.equal(parseSheet(JSON.parse(serialize(imported.sheet))).rows.length,2500);
  assert.throws(()=>prepareImportedRows(imported.sheet,['超过上限']),/2500/);
});
