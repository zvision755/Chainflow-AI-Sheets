import {checkMarkdown} from './markdown-check';
import {expect,type Page} from '@playwright/test';
import {emptyCell,newColumn,type Sheet} from '../../core/types';

export async function checkSourceTemplates(page:Page){
 const columns=[newColumn('sentence','语境',[]),newColumn('grammar','结构解析',['sentence']),newColumn('word','单词',[]),newColumn('meaning','语境释义',['sentence','word'])];
 columns.forEach(c=>c.prompt=c.sources.length?'根据语境解释单词':'');
 const sheet:Sheet={version:1,name:'指定来源模板验收',columns,rows:[{id:'source-row',cells:{sentence:emptyCell('彼は将来に備えて貯金している。','done'),grammar:emptyCell('助词说明','done'),word:emptyCell('備える','done'),meaning:emptyCell()}}]};
 await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'source-templates.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sheet))});
 await page.getByRole('button',{name:'单词',exact:true}).click();
 const manual=page.getByRole('dialog');
 await expect(manual.getByRole('note')).toContainText('这是手动输入列');
 await expect(manual.getByLabel('系统提示词',{exact:true})).toHaveCount(0);
 await expect(manual.getByRole('button',{name:'保存配置',exact:true})).toBeEnabled();
 await manual.getByRole('button',{name:'保存配置',exact:true}).click();
 await page.getByRole('button',{name:'语境释义',exact:true}).click();
 const dialog=page.getByRole('dialog'),save=dialog.getByRole('button',{name:'保存配置',exact:true});
 await expect(dialog.getByRole('note')).toContainText('用户提示词必须使用每个来源列的内容模板');
 await expect(dialog.getByRole('alert')).toContainText('多来源已禁用');
 await expect(dialog.getByLabel('插入来源内容模板',{exact:true})).toBeDisabled();await expect(save).toBeDisabled();
 const user=dialog.getByLabel('用户提示词',{exact:true});
 await user.fill('语境：');await dialog.getByLabel('插入A列内容模板',{exact:true}).click();
 await expect(save).toBeDisabled();
 await user.fill((await user.inputValue())+'\n需要解释的单词：');await user.press('Control+End');await dialog.getByLabel('插入C列内容模板',{exact:true}).click();
 await expect(user).toHaveValue('语境：{{source:A}}\n需要解释的单词：{{source:C}}');await expect(save).toBeEnabled();
 await dialog.getByText('预览实际请求',{exact:true}).click();
 await expect(dialog.getByLabel('展开后的用户提示词',{exact:true})).toHaveText('语境：彼は将来に備えて貯金している。\n需要解释的单词：備える');
 const sourceChoices=dialog.locator('fieldset').filter({has:page.getByText('来源列',{exact:true})}).locator('input[type=checkbox]');
 await sourceChoices.nth(2).uncheck();await expect(save).toBeDisabled();await expect(dialog.getByRole('alert')).toContainText('不再对应');
 await sourceChoices.nth(2).check();await expect(save).toBeEnabled();await save.click();
 await expect(page.getByLabel('用户提示词',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'语境释义',exact:true}).click();
 await expect(page.getByLabel('用户提示词',{exact:true})).toHaveValue('语境：{{source:A}}\n需要解释的单词：{{source:C}}');
 await page.getByLabel('关闭列配置',{exact:true}).click();
 await checkMarkdown(page);
}
