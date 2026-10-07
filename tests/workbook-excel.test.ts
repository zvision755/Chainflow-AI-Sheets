import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { excelSheetName, workbookExcel } from '../core/workbook-excel';
import { initialWorkspace, addTable } from '../core/workspace';
import { savedExample } from '../core/example-workflow';
test('Excel exports each table as its own named tab with column headers and complete text',async()=>{
 let workspace=initialWorkspace();workspace.tables[0].sheet.name='业务表';workspace.tables[0].sheet.rows[0].cells.input.value='=1+1';workspace=addTable(workspace,savedExample());
 const bytes=await workbookExcel(workspace);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes) as any);
 assert.deepEqual(book.worksheets.map(s=>s.name),['业务表','日语词汇学习']);assert.equal(book.worksheets[0].getCell('A2').value,'=1+1');assert.equal(book.worksheets[0].getCell('A2').type,ExcelJS.ValueType.String);
 assert.equal(book.worksheets[1].getCell('A1').value,'日语单词');assert.equal(book.worksheets[1].getCell('A4').value,'直す');assert.equal(book.worksheets[1].getCell('C4').value,workspace.tables[1].sheet.rows[2].cells.teacher.value);
 assert.equal(book.worksheets[1].views[0].state,'frozen');assert.equal(book.views[0].activeTab,1);assert.equal(book.worksheets[1].getCell('C4').alignment.wrapText,true);
});
test('Excel tab names handle duplicates, invalid characters, empty names, reserved names and length limits',()=>{
 const used=new Set<string>();assert.equal(excelSheetName('a/b:*?[]\\',used),'a b');assert.equal(excelSheetName('A B',used),'A B (2)');assert.equal(excelSheetName('',used),'未命名表格');assert.equal(excelSheetName('History',used),'History 表格');const long='长'.repeat(40);assert.equal(excelSheetName(long,used).length,31);assert.equal(excelSheetName(long,used).length,31);
});
