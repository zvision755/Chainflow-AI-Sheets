import {desktopCell,editDesktopCell} from './desktop-cell';
import {expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {emptyCell,newColumn,type Sheet} from '../../core/types';
export async function checkDesktopWindow(page:Page){
 const columns=[newColumn('p-a','性能输入',[]),newColumn('p-b','性能说明',['p-a']),newColumn('p-c','性能解析',['p-a']),newColumn('p-d','性能释义',['p-a'])];columns.forEach(c=>c.prompt='说明');columns[2].displayMode='markdown';columns[3].displayMode='markdown';
 const text='# 语境解释\n\n**単語**：'+('これは文脈に応じた説明です。'.repeat(20))+'\n\n- 第一条\n- 第二条\n\n| 词 | 意思 |\n| --- | --- |\n| 単語 | 词语 |';
 const sheet:Sheet={version:1,name:'500行性能验收',columns,rows:Array.from({length:500},(_,i)=>({id:'performance-'+i,cells:Object.fromEntries(columns.map((c,j)=>[c.id,{...emptyCell(j?text:'单词'+i,'done'),...(j?{history:[text],historyIndex:0}:{})}]))}))};
 await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'desktop-500.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sheet))});
 await expect(page.getByLabel('表格名称',{exact:true})).toHaveValue(sheet.name);
 const scroll=page.locator('.desktop-table-scroll'),rows=scroll.locator('tbody tr[data-row-id]');
 await expect(desktopCell(page,'第 1 行 性能输入')).toHaveText('单词0');expect(await rows.count()).toBeLessThan(25);await expect(scroll.locator('tbody tr[data-row-id]').first()).toHaveCSS('height','168px');await expect(scroll.locator('.desktop-cell-preview').first()).toHaveCSS('-webkit-line-clamp','4');expect(await scroll.locator('.markdown-content').count()).toBe(0);
 const layout=await scroll.evaluate(el=>{const row=el.querySelector('tr[data-row-id]')!,cell=row.querySelectorAll('td')[2],footer=cell.querySelector('.cell-footer')!,history=cell.querySelector('.cell-history')!;return {widths:Array.from(el.querySelectorAll('.data-col'),c=>c.getBoundingClientRect().width),iconText:Array.from(footer.querySelectorAll('button'),b=>b.textContent?.trim()),alignedHistory:Math.abs(history.getBoundingClientRect().top+history.clientHeight/2-footer.getBoundingClientRect().top-footer.clientHeight/2)<2,gap:getComputedStyle(row.querySelector('.row-actions')!).gap};});
 expect(layout.widths).toEqual([440,440,440,440]);expect(layout.iconText.every(text=>!text)).toBe(true);expect(layout.alignedHistory).toBe(true);expect(layout.gap).toBe('6px');
 const header=await scroll.locator('thead th').nth(2).evaluate(el=>{const source=el.querySelector('.column-source')!.getBoundingClientRect(),model=el.querySelector('.column-meta')!.getBoundingClientRect();return Math.abs((source.top+source.bottom)/2-(model.top+model.bottom)/2)<2;});expect(header).toBe(true);
 await editDesktopCell(page,'第 1 行 性能输入','首行修改');
 await page.getByRole('button',{name:'跳到末行',exact:true}).click();await expect(desktopCell(page,'第 500 行 性能输入')).toHaveText('单词499');await editDesktopCell(page,'第 500 行 性能输入','末行修改');expect(await rows.count()).toBeLessThan(25);await expect(page.getByRole('separator')).toHaveCount(0);
 await page.getByRole('button',{name:'回到首行',exact:true}).click();await expect(desktopCell(page,'第 1 行 性能输入')).toHaveText('首行修改');
 await page.getByRole('button',{name:'跳到末行',exact:true}).click();await expect(desktopCell(page,'第 500 行 性能输入')).toHaveText('末行修改');
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();const exported=JSON.parse(await readFile(await (await download).path(),'utf8'));
 const workbook=exported.workspace??exported;const stored=workbook.tables.find((t:{sheet:Sheet})=>t.sheet.name===sheet.name).sheet as Sheet;
 expect(stored.rows).toHaveLength(500);expect(stored.rows[0].id).toBe('performance-0');expect(stored.rows[499].cells['p-a'].value).toBe('末行修改');expect(stored.rows[10].cells['p-d'].history).toEqual([text]);expect(stored.rows[499].height).toBeUndefined();
 await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(desktopCell(page,'第 1 行 性能输入')).toHaveText('首行修改');await page.getByRole('button',{name:'跳到末行',exact:true}).click();await expect(desktopCell(page,'第 500 行 性能输入')).toHaveText('末行修改');
}
