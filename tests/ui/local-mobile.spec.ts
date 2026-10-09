import {test,expect} from '@playwright/test';
test('shared mobile editor saves a new row and restores after reload in both Local modes',async({page})=>{
 await page.goto('./');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(page.locator('.app-shell')).toHaveAttribute('data-view','mobile');
 await page.getByRole('button',{name:'查看第 1 行 输入',exact:true}).click();
 await page.getByRole('button',{name:'编辑 输入',exact:true}).click();await page.getByLabel('填写 输入',{exact:true}).fill('手机持久化');await page.getByRole('button',{name:'完成编辑 输入',exact:true}).click();await page.getByLabel('关闭行详情',{exact:true}).click();
 await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(page.getByRole('button',{name:'查看第 1 行 输入',exact:true})).toContainText('手机持久化');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
