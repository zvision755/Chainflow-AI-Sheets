import {expect,type Page} from '@playwright/test';
export function desktopCell(page:Page,label:string){return page.getByLabel('查看'+label,{exact:true}).locator('.desktop-cell-preview');}
export async function editDesktopCell(page:Page,label:string,value:string){
 const column=label.replace(/^第 \d+ 行 /,'');
 await page.getByLabel('编辑单元格 '+label,{exact:true}).click();
 await expect(page.getByLabel('填写 '+column,{exact:true})).toBeFocused();
 await page.getByLabel('填写 '+column,{exact:true}).fill(value);
 await page.getByLabel('关闭行详情',{exact:true}).click();await expect(page.getByLabel('关闭行详情',{exact:true})).toHaveCount(0);
}
