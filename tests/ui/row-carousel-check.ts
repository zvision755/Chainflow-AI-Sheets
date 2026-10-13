import {expect,type Page,type Locator} from '@playwright/test';
import {emptyCell,newColumn,type Sheet} from '../../core/types';
import {defaultRunOptions} from '../../core/run-settings';

export function carouselWorkspace(){
  const columns=[newColumn('a','原始内容',[]),newColumn('b','长内容',[]),newColumn('c','代码',[])];
  columns[2].displayMode='markdown';
  const sheet:Sheet={version:1,name:'滑动验收',columns,rows:Array.from({length:12},(_,index)=>({id:`carousel-${index+1}`,cells:{a:emptyCell(`记录 ${index+1}`,'done'),b:emptyCell('长内容\n'.repeat(80),'done'),c:emptyCell('```text\n'+'abcdefghijklmnopqrstuvwxyz'.repeat(30)+'\n```','done')}}))};
  return {version:1 as const,activeId:'carousel',tables:[{id:'carousel',sheet,options:{...defaultRunOptions}}]};
}
export async function seedCarousel(page:Page){
  await page.addInitScript(workspace=>{localStorage.setItem('chainflow-workspace-v1',JSON.stringify(workspace));localStorage.setItem('chainflow-view-preference-v1','mobile');},carouselWorkspace());
}
export async function swipeExistingRow(page:Page,delta:number){
  const target=page.locator('.row-detail-current .row-card-text').first(),box=(await target.boundingBox())!;
  const start=box.x+box.width*.7,y=box.y+10;
  const event={pointerId:77,pointerType:'touch',isPrimary:true,clientY:y,bubbles:true};
  await target.dispatchEvent('pointerdown',{...event,clientX:start});
  await target.dispatchEvent('pointermove',{...event,clientX:start-delta*150});
  await target.dispatchEvent('pointerup',{...event,clientX:start-delta*150});
}
export async function checkRowCarousel(page:Page){
  const current=page.locator('.row-detail-current'),track=page.locator('.row-detail-track');
  const title=page.locator('#row-detail-title');
  await page.getByRole('button',{name:'查看第 10 行 原始内容',exact:true}).click();
  await expect(title).toHaveText('第 10 行');
  // Observe after React's transitionend handler, before another task/frame can
  // hide a stale center page. The handoff must already contain the target row.
  await page.evaluate(()=>{
    const results:{title:string|null;text:string|null}[]=[];
    (window as Window & {carouselHandoffs?:typeof results}).carouselHandoffs=results;
    window.addEventListener('transitionend',event=>{
      if(event.propertyName==='transform'&&(event.target as HTMLElement).classList.contains('row-detail-track'))results.push({title:document.querySelector('#row-detail-title')?.textContent??null,text:document.querySelector('.row-detail-current [data-column-id="a"] .row-card-text')?.textContent??null});
    });
  });
  let target:Locator=current.locator('[data-column-id="a"] .row-card-text');
  const chromium=page.context().browser()?.browserType().name()==='chromium';
  const cdp=chromium?await page.context().newCDPSession(page):null;
  let x=0,y=0;
  async function event(type:'start'|'move'|'end',dx=0,dy=0){
    if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:type==='start'?'touchStart':type==='move'?'touchMove':'touchEnd',touchPoints:type==='end'?[]:[{x:x+dx,y:y+dy}]});
    else await target.dispatchEvent(type==='start'?'pointerdown':type==='move'?'pointermove':'pointerup',{pointerId:51,pointerType:'touch',isPrimary:true,clientX:x+dx,clientY:y+dy,bubbles:true});
  }
  async function start(locator=target){target=locator;const box=(await target.boundingBox())!;x=box.x+Math.min(280,box.width*.75);y=box.y+Math.min(16,box.height/2);await event('start');await page.waitForTimeout(20);}
  async function slide(dx:number,slow=false){await start(current.locator('[data-column-id="a"] .row-card-text'));await event('move',dx/2);await page.waitForTimeout(20);await event('move',dx);if(slow)await page.waitForTimeout(130);await event('end',dx);}
  try{
    await start();await event('move',-150);
    await expect.poll(()=>track.evaluate(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).m41)).toBeLessThan(-430);
    expect(await page.locator('.row-detail-preview').last().locator('[data-preview-column-id="a"] .row-card-text').innerText()).toBe('记录 11');
    const visible=await page.locator('.row-detail-carousel').evaluate(view=>{const pages=view.querySelectorAll('.row-detail-content'),bounds=view.getBoundingClientRect(),a=pages[1].getBoundingClientRect(),b=pages[2].getBoundingClientRect();return a.left<bounds.left-50&&b.left<bounds.right&&b.right>bounds.right;});expect(visible).toBe(true);
    await event('end',-150);await expect(title).toHaveText('第 11 行');
    expect(await page.evaluate(()=>(window as Window & {carouselHandoffs?:unknown[]}).carouselHandoffs?.[0])).toEqual({title:'第 11 行',text:'记录 11'});
    await slide(150);await expect(title).toHaveText('第 10 行');
    expect(await page.evaluate(()=>(window as Window & {carouselHandoffs?:unknown[]}).carouselHandoffs?.[1])).toEqual({title:'第 10 行',text:'记录 10'});
    await slide(-40,true);await expect.poll(()=>track.evaluate(node=>Math.round(new DOMMatrixReadOnly(getComputedStyle(node).transform).m41))).toBe(-390);await expect(title).toHaveText('第 10 行');
    // Use controlled event times for the short fling: CDP round trips can be
    // slower than a finger, especially in the desktop Server test context.
    await current.locator('[data-column-id="a"] .row-card-text').evaluate(node=>{
      const box=node.getBoundingClientRect(),x=box.x+box.width*.75,y=box.y+12,t=performance.now();
      for(const [type,dx,dt] of [['pointerdown',0,0],['pointermove',-20,20],['pointermove',-40,40],['pointerup',-40,45]] as const){
        const event=new PointerEvent(type,{pointerId:89,pointerType:'touch',isPrimary:true,bubbles:true,clientX:x+dx,clientY:y});
        Object.defineProperty(event,'timeStamp',{value:t+dt});node.dispatchEvent(event);
      }
    });await expect(title).toHaveText('第 11 行');
    for(let i=0;i<2;i++){await slide(150);await expect(title).toHaveText('第 10 行');await slide(-150);await expect(title).toHaveText('第 11 行');}
    await page.getByLabel('编辑 原始内容',{exact:true}).click();const area=page.getByLabel('填写 原始内容',{exact:true});await area.fill('已编辑且保存');await start(area);await event('move',-150);await event('end',-150);await expect(title).toHaveText('第 11 行');await expect(area).toHaveValue('已编辑且保存');
    await page.getByLabel('下一行',{exact:true}).click();await expect(title).toHaveText('第 12 行');
    await slide(-160);await expect(title).toHaveText('第 12 行');await expect(page.getByLabel('下一行',{exact:true})).toBeDisabled();
    await page.getByLabel('上一行',{exact:true}).click();await expect(title).toHaveText('第 11 行');await expect(current.locator('[data-column-id="a"] .row-card-text')).toHaveText('已编辑且保存');
    // Native touch events verify that the browser actually scrolls vertically and
    // horizontally in code; pointer-only fallback verifies direction exclusion.
    await current.evaluate(node=>node.scrollTop=0);
    await start(current.locator('[data-column-id="b"] .row-card-text'));await event('move',0,-180);await event('end',0,-180);
    if(cdp)await expect.poll(()=>current.evaluate(node=>node.scrollTop)).toBeGreaterThan(40);
    await expect(title).toHaveText('第 11 行');
    const code=current.locator('pre');await code.scrollIntoViewIfNeeded();await start(code);await event('move',-140);await event('end',-140);
    if(cdp)await expect.poll(()=>code.evaluate(node=>node.scrollLeft)).toBeGreaterThan(20);
    await expect(title).toHaveText('第 11 行');
    await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('下一行',{exact:true}).click();await expect(title).toHaveText('第 12 行');await expect(track).toHaveCSS('transition-duration','0s');
    await page.getByLabel('关闭行详情',{exact:true}).click();await page.getByRole('button',{name:'查看第 1 行 原始内容',exact:true}).click();await slide(160);await expect(title).toHaveText('第 1 行');await expect(page.getByLabel('上一行',{exact:true})).toBeDisabled();
  }finally{await cdp?.detach();}
}
