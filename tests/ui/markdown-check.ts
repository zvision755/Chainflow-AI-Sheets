import {checkDesktopWindow} from './desktop-window-check';
import {expect,type Page} from '@playwright/test';
import {emptyCell,newColumn,type Sheet} from '../../core/types';
export async function checkMarkdown(page:Page){
 const raw='# 语境标题\n\n**備える**：准备\n\n- 第一条\n- 第二条\n\n| 词 | 意思 |\n| --- | --- |\n| 備える | 准备 |\n\n[危险](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![说明](https://example.com/tracker.png)';
 const columns=[newColumn('md-original','Markdown来源',[]),newColumn('md-target','下游测试',['md-original'])];columns[1].prompt='解释来源';
 const sheet:Sheet={version:1,name:'Markdown验收',columns,rows:[{id:'md-row',cells:{'md-original':emptyCell(raw,'done'),'md-target':emptyCell()}}]};
 await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'markdown.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sheet))});
 await page.getByRole('button',{name:'Markdown来源',exact:true}).click();
 await page.getByLabel('内容显示',{exact:true}).selectOption('markdown');await page.getByRole('dialog').getByRole('button',{name:'保存配置',exact:true}).click();
 const mobile=await page.locator('.mobile-table').isVisible().catch(()=>false);
 if(mobile){
  const preview=page.locator('.mobile-cell-preview').first();await expect(preview).toContainText('语境标题');expect(await preview.textContent()).not.toMatch(/\*\*|^#|<script>/);
  await expect(page.locator('.mobile-table h1')).toHaveCount(0);
  await page.getByLabel('查看第 1 行 Markdown来源',{exact:true}).click();
  }else {const preview=page.locator('.desktop-cell-preview').first();await expect(preview).toContainText('语境标题');expect(await preview.textContent()).not.toMatch(/\*\*|^#|<script>/);await expect(page.locator('.desktop-table-scroll .markdown-content')).toHaveCount(0);await page.getByLabel('查看第 1 行 Markdown来源',{exact:true}).click();}
 const content=page.locator('.markdown-content').first();await expect(content.locator('strong')).toHaveText('備える');await expect(content.locator('table')).toBeVisible();
 await expect(content.locator('script,img')).toHaveCount(0);await expect(content.getByText('危险',{exact:true})).not.toHaveAttribute('href',/javascript:/);
 await page.getByLabel('编辑 Markdown来源',{exact:true}).click();await expect(page.getByLabel('填写 Markdown来源',{exact:true})).toHaveValue(raw);await page.getByLabel('关闭行详情',{exact:true}).click();
 await page.getByRole('button',{name:'下游测试',exact:true}).click();await page.getByText('预览实际请求',{exact:true}).click();
 const actual=page.getByLabel('展开后的用户提示词',{exact:true});await expect(actual).toContainText('備える：准备');expect(await actual.textContent()).not.toMatch(/\*\*|<script>|\| ---/);
 await page.getByLabel('关闭列配置',{exact:true}).click();await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');
 await page.getByRole('button',{name:'Markdown来源',exact:true}).click();await expect(page.getByLabel('内容显示',{exact:true})).toHaveValue('markdown');await page.getByLabel('关闭列配置',{exact:true}).click();
 if(!mobile)await checkDesktopWindow(page);
}
