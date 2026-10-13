import {desktopCell,editDesktopCell} from './desktop-cell';
import {checkSourceTemplates} from './source-template-check';
import {test,expect} from '@playwright/test';
import {carouselWorkspace,checkRowCarousel} from './row-carousel-check';
test('Server retains authentication, shared workspace, encrypted key and protected AI/TTS/Agent APIs',async({page,context})=>{
 await page.addInitScript(()=>localStorage.setItem('chainflow-view-preference-v1','desktop'));
 await page.goto('/');await expect(page.getByRole('heading',{name:'设置管理员账户'})).toBeVisible();
 await page.getByLabel('用户名',{exact:true}).fill('regression');await page.getByLabel('密码',{exact:true}).fill('test-only');await page.getByLabel('确认密码',{exact:true}).fill('test-only');await page.getByRole('button',{name:'创建账户并登录'}).click();
 await page.getByRole('button',{name:'创建全新空白工作簿'}).click();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await editDesktopCell(page,'第 1 行 输入','服务器持久化');await expect(page.locator('.local-save')).toContainText('已保存');
 await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await expect(desktopCell(page,'第 1 行 输入')).toHaveText('服务器持久化');
 await page.getByRole('button',{name:'复制当前表格',exact:true}).click();await expect(desktopCell(page,'第 1 行 输入')).toHaveText('服务器持久化');await expect(page.getByLabel('表格名称',{exact:true})).toHaveValue('未命名表格（副本）');
 const response=await context.request.get('/api/workspace');expect(response.status()).toBe(200);expect(await response.text()).toContain('服务器持久化');
 const status=await (await context.request.get('/api/auth/status')).json();
 const settings=await (await context.request.get('/api/settings')).json();
 const saved=await context.request.put('/api/settings',{headers:{'X-Chainflow-Csrf':status.csrf},data:{revision:settings.revision,connection:{provider:'openai',customUrl:''},modelKey:'test-only-regression-key',tts:{provider:'external',url:'https://api.openai.com/v1',model:'tts-1',speed:1,voices:{ja:'alloy',en:'alloy','en-gb':'alloy',zh:'alloy'}},ttsKey:'test-only-tts-key'}});expect(saved.status()).toBe(200);expect(await saved.text()).not.toContain('test-only-regression-key');
 const headers={'X-Chainflow-Csrf':status.csrf};
 const ai=await context.request.post('/api/generate',{headers,data:{model:'gpt-6-luna',prompt:'说明',input:'测试',maxTokens:128,reasoning:'none'}});expect(ai.status()).toBe(200);
 const tts=await context.request.post('/api/local-tts/speech',{headers,data:{url:'https://api.openai.com/v1',model:'tts-1',voice:'alloy',speed:1,language:'ja',input:'朗读'}});expect(tts.status()).toBe(200);expect(tts.headers()['content-type']).toContain('audio/wav');
 const agent=await context.request.post('/api/local-agent/generate',{headers,data:{model:'gpt-6-luna',prompt:'说明',input:'测试',maxTokens:128,reasoning:'none',stream:true}});expect(agent.status()).toBe(200);expect(await agent.text()).toContain('Agent 测试结果');
 await checkSourceTemplates(page);
 await context.request.post('/api/auth/logout',{headers:{...headers,'X-Chainflow-Auth':'1'},data:{}});
 for(const path of ['/api/workspace','/api/settings'])expect((await context.request.get(path)).status()).toBe(401);
 for(const path of ['/api/generate','/api/local-tts/speech','/api/local-agent/generate'])expect((await context.request.post(path,{data:{}})).status()).toBe(401);
});

test('authenticated Server mobile shares the carousel and persists edits against stable row IDs',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});await page.addInitScript(()=>localStorage.setItem('chainflow-view-preference-v1','mobile'));
 const login=await context.request.post('/api/auth/login',{headers:{'X-Chainflow-Auth':'1'},data:{username:'regression',password:'test-only',secure:false}});expect(login.status()).toBe(200);
 const status=await(await context.request.get('/api/auth/status')).json(),document=await(await context.request.get('/api/workspace')).json();
 const saved=await context.request.put('/api/workspace',{headers:{'X-Chainflow-Csrf':status.csrf},data:{revision:document.revision,workspace:carouselWorkspace()}});expect(saved.status()).toBe(200);
 await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');await checkRowCarousel(page);
 await expect.poll(async()=>await(await context.request.get('/api/workspace')).text()).toContain('已编辑且保存');
});
