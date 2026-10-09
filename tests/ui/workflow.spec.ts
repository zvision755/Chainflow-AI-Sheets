import {test,expect} from '@playwright/test';
import {example} from '../../core/types';
import {defaultRunOptions} from '../../core/run-settings';
test.beforeEach(async({page})=>{
 await page.addInitScript(({sheet,options})=>{if(!localStorage.getItem('chainflow-workspace-v1'))localStorage.setItem('chainflow-workspace-v1',JSON.stringify({version:1,activeId:'test-sheet',tables:[{id:'test-sheet',sheet,options}]}));localStorage.setItem('chainflow-view-preference-v1','desktop');},{sheet:example(),options:{...defaultRunOptions,autoRetry:false,streaming:false,dependencyDelayMs:0}});
 await page.route('**/api/capabilities',route=>route.fulfill({json:{codex:false,tts:true,builtinTts:true}}));
});
const key='sk-ui-test-session-memory-123456789';
test('runtime budget fields accept typed limits and retain them after reload',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');
 await page.getByLabel('并发',{exact:true}).fill('10');await page.getByLabel('并发',{exact:true}).press('Enter');
 await page.getByLabel('失败自动重试',{exact:true}).check();await page.getByLabel('最多自动重试次数',{exact:true}).fill('5');await page.getByLabel('最多自动重试次数',{exact:true}).press('Enter');
 await page.getByRole('button',{name:'Agent 模式',exact:true}).click();await page.getByLabel('整次运行时限',{exact:true}).fill('60');await page.getByLabel('整次运行时限',{exact:true}).press('Enter');
 await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');
 await expect(page.getByLabel('并发',{exact:true})).toHaveValue('10');await expect(page.getByLabel('最多自动重试次数',{exact:true})).toHaveValue('5');await expect(page.getByLabel('整次运行时限',{exact:true})).toHaveValue('60');
 await page.getByLabel('并发',{exact:true}).fill('11');await page.getByLabel('并发',{exact:true}).press('Enter');await expect(page.getByLabel('并发',{exact:true})).toHaveValue('10');
 await page.getByLabel('整次运行时限',{exact:true}).fill('');await page.getByLabel('整次运行时限',{exact:true}).press('Enter');await expect(page.getByLabel('整次运行时限',{exact:true})).toHaveValue('60');
});
async function connect(page:any){await page.getByRole('button',{name:'连接 API key'}).click();await page.getByLabel('API key',{exact:true}).fill(key);await page.getByRole('button',{name:'完成',exact:true}).click();}
async function run(page:any){await page.getByRole('button',{name:'运行全部',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('个待执行单元格');await page.getByLabel('生成范围',{exact:true}).selectOption('pending');await page.getByRole('button',{name:'确认运行'}).click();}
test('complete chain, no duplicate calls, edit/retry and refresh clears credential',async({page})=>{
 let calls:any[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/generate',async route=>{const d=route.request().postDataJSON();calls.push(d);await new Promise(r=>setTimeout(r,100));await route.fulfill({json:{text:calls.length%2===1?'フレームは枠という意味です。':'老师解释：这句话说明フレーム表示框架。',usage:{input:10,output:20}}});});
 await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(page.getByLabel('表格名称',{exact:true})).toHaveValue('日语词汇学习');await connect(page);await run(page);
 await expect(page.getByLabel('第 1 行 老师解读',{exact:true})).toHaveValue('老师解释：这句话说明フレーム表示框架。');await expect(page.getByTestId('running-count')).toContainText('正在生成 0 个');expect(calls).toHaveLength(2);expect(calls[1].input).toBe('フレームは枠という意味です。');
 await page.getByLabel('第 1 行 日语单词',{exact:true}).fill('フレーム2');await expect(page.getByText('需要更新',{exact:true})).toHaveCount(2);expect(calls).toHaveLength(2);await run(page);await expect.poll(()=>calls.length).toBe(4);await expect(page.getByTestId('running-count')).toContainText('正在生成 0 个');
 const stored=await page.evaluate(()=>JSON.stringify(localStorage));expect(stored).not.toContain(key);await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(page.getByLabel('第 1 行 老师解读',{exact:true})).toHaveValue('老师解释：这句话说明フレーム表示框架。');await expect(page.getByRole('button',{name:'连接 API key'})).toBeVisible();expect(calls).toHaveLength(4);expect(errors).toEqual([]);
 await page.screenshot({path:'outputs/desktop.png',fullPage:true});
});
test('invalid key/upstream failure settles to zero and retry repairs',async({page})=>{
 let valid=false,calls=0;await page.route('**/api/generate',async r=>{calls++;await r.fulfill(valid?{json:{text:'フレームの説明',usage:{input:1,output:1}}}:{status:401,json:{error:{code:'invalid_key',message:'密钥无效或已撤销，请重新输入',retryable:false}}});});
 await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await connect(page);await run(page);await expect(page.getByText('上游未完成或失败，请先修正上游后重试')).toBeVisible();await expect(page.getByTestId('running-count')).toContainText('正在生成 0 个');expect(calls).toBe(1);valid=true;await run(page);await expect(page.getByLabel('第 1 行 老师解读',{exact:true})).toHaveValue('フレームの説明');expect(calls).toBe(3);
});
test('cycle choices blocked, column CRUD, row ordering, cell copy and mobile width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await page.getByLabel('设置 日语释义',{exact:true}).click();await expect(page.getByRole('dialog').getByRole('checkbox').nth(2)).toBeDisabled();await page.getByLabel('列名称',{exact:true}).fill('新释义');await page.getByRole('button',{name:'保存配置'}).click();await expect(page.getByRole('button',{name:'新释义',exact:true})).toBeVisible();await page.getByRole('button',{name:'新增一行',exact:true}).click();await page.getByLabel('第 2 行 日语单词',{exact:true}).fill('第二词');const secondInput=await page.getByLabel('第 2 行 日语单词',{exact:true}).inputValue();await page.getByRole('button',{name:'下移第 1 行'}).click();await expect(page.getByLabel('第 2 行 日语单词',{exact:true})).toHaveValue('フレーム');await expect(page.getByLabel('第 1 行 日语单词',{exact:true})).toHaveValue(secondInput);await page.getByRole('button',{name:'上移第 2 行'}).click();await expect(page.getByLabel('第 1 行 日语单词',{exact:true})).toHaveValue('フレーム');await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'复制第 1 行 日语单词'}).click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('フレーム');await page.getByRole('button',{name:'新增列',exact:true}).click();await page.getByLabel('列名称',{exact:true}).fill('总结');await page.getByLabel('系统提示词',{exact:true}).fill('总结来源');await page.getByRole('button',{name:'保存配置'}).click();await page.getByLabel('设置 总结',{exact:true}).click();await page.getByRole('button',{name:'删除列',exact:true}).click();await expect(page.getByRole('button',{name:'总结',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'outputs/mobile.png',fullPage:true});
});
test('stop active run, prevent stale response, no calls from blur',async({page})=>{
 let calls=0;await page.route('**/api/generate',async r=>{calls++;await new Promise(resolve=>setTimeout(resolve,600));await r.fulfill({json:{text:'旧结果',usage:{input:1,output:1}}}).catch(()=>{});});
 await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await connect(page);await run(page);await expect.poll(()=>calls).toBe(1);await page.getByRole('button',{name:'停止',exact:true}).click();await expect(page.getByTestId('running-count')).toContainText('正在生成 0 个');await expect(page.getByText('已取消',{exact:true})).toHaveCount(2);await page.getByLabel('第 1 行 日语单词',{exact:true}).fill('新输入');await page.getByLabel('表格名称',{exact:true}).click();await page.waitForTimeout(700);expect(calls).toBe(1);await expect(page.getByLabel('第 1 行 日语释义',{exact:true})).toHaveValue('');
});
