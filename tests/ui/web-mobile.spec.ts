import {test,expect} from '@playwright/test';
test('shared mobile editor saves a new row and restores after reload in Web',async({page})=>{
 await page.goto('./');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(page.locator('.app-shell')).toHaveAttribute('data-view','mobile');
 await page.setViewportSize({width:402,height:874});
 await expect.poll(()=>page.locator('.mobile-table').evaluate(table=>{const headers=table.querySelectorAll('th');const a=headers[1].getBoundingClientRect(),b=headers[2].getBoundingClientRect();return Math.abs(a.width-b.width)<1&&b.right<=table.parentElement!.getBoundingClientRect().right+1;})).toBe(true);
 await page.getByRole('button',{name:'查看第 1 行 输入',exact:true}).click();
 await page.getByRole('button',{name:'编辑 输入',exact:true}).click();await page.getByLabel('填写 输入',{exact:true}).fill('手机持久化');await page.getByRole('button',{name:'完成编辑 输入',exact:true}).click();await page.getByLabel('关闭行详情',{exact:true}).click();
 await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(page.getByRole('button',{name:'查看第 1 行 输入',exact:true})).toContainText('手机持久化');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(402);
});

test('Web mobile columns stay compact on iPad and resize back to portrait with the view preference preserved',async({page})=>{
 await page.goto('./');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');
 await page.getByLabel('应用菜单',{exact:true}).click();
 await page.getByRole('menuitemradio',{name:'手机版',exact:true}).click();
 for(const width of [390,768,1024,1366,390]){
  await page.setViewportSize({width,height:844});
  await expect.poll(()=>page.locator('.mobile-table').evaluate(table=>{
   const container=table.parentElement!;const headers=Array.from(table.querySelectorAll('th'),cell=>cell.getBoundingClientRect());
   const data=headers.slice(1);const right=container.getBoundingClientRect().right;
   return data.every(cell=>cell.width<=221&&Math.abs(cell.width-data[0].width)<1)
    && headers[2].right<=right+1
    && (container.clientWidth>=700?data.every(cell=>cell.right<=right+1):true);
  })).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
 await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-view','mobile');
 await expect(page.locator('.mobile-table')).toBeVisible();
});
