import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownToText,cellText} from '../core/markdown';
import {example} from '../core/types';
import {serialize,parseSheet} from '../core/storage';
import {Scheduler} from '../core/scheduler';
import {buildPrompts,promptContext} from '../core/prompt-templates';
test('Markdown text removes formatting but preserves text, code, literal symbols and table structure',()=>{
 assert.equal(markdownToText('# 标题\n\n**単語**、*说明*、~~旧词~~\n\n- 一\n- 二\n\n[名称](https://example.com) ![图片说明](https://example.com/p.png)'), '标题\n単語、说明、旧词\n一\n二\n名称 图片说明');
 assert.equal(markdownToText('```js\n2 * 3; # 不删代码\n```'),'2 * 3; # 不删代码');
 assert.equal(markdownToText('\\# 字面标题\n\n2 * 3'),'# 字面标题\n2 * 3');
 assert.equal(markdownToText('| 单词 | 意思 |\n| --- | --- |\n| **備える** | 准备 |'),'单词\t意思\n備える\t准备');
 assert.equal(markdownToText('<script>alert(1)</script>'),'');
});
test('plain columns are unchanged and Markdown persistence/export retains raw values and history',()=>{
 const sheet=example(),raw='# 标题\n\n**内容**';sheet.rows[0].cells.input.value=raw;
 assert.equal(cellText(sheet.columns[0],raw),raw);sheet.columns[0].displayMode='markdown';
 sheet.rows[0].cells.input.history=[raw];const restored=parseSheet(JSON.parse(serialize(sheet)));
 assert.equal(restored.columns[0].displayMode,'markdown');assert.equal(restored.rows[0].cells.input.value,raw);assert.deepEqual(restored.rows[0].cells.input.history,[raw]);
 assert.equal(cellText(restored.columns[0],raw),'标题\n内容');
});
test('source templates and API/Agent calls receive plain text only from Markdown columns',async()=>{
 for(const mode of ['api','agent'] as const){
 const sheet=example();sheet.columns[0].displayMode='markdown';sheet.rows[0].cells.input.value='**備える**';
 const requests:string[]=[];const e=new Scheduler(sheet,async p=>{requests.push(p.input);return {text:'正常说明',usage:{input:1,output:1}};});
 assert.equal(buildPrompts(sheet.columns[1],promptContext(sheet,'row-1',sheet.columns[1])).input,'備える');
 e.run(e.targets('all'),{mode,concurrency:3,timeout:1000,maxSteps:20,maxRetries:0,totalTimeout:5000,dependencyDelayMs:0,autoRetry:false});while(e.busy)await new Promise(r=>setTimeout(r,5));
 assert.equal(requests[0],'備える');assert.equal(sheet.rows[0].cells.input.value,'**備える**');
 }
});
test('changing display mode keeps original output and history but invalidates downstream results',()=>{
 const sheet=example();sheet.rows[0].cells.explain.value='**说明**';sheet.rows[0].cells.explain.status='done';sheet.rows[0].cells.explain.history=['**说明**'];sheet.rows[0].cells.teacher.status='done';
 const e=new Scheduler(sheet,async()=>{throw Error('must not run');});e.configure({...sheet.columns[1],displayMode:'markdown'});
 assert.equal(sheet.rows[0].cells.explain.status,'done');assert.equal(sheet.rows[0].cells.explain.value,'**说明**');assert.equal(sheet.rows[0].cells.teacher.status,'stale');assert.deepEqual(sheet.rows[0].cells.explain.history,['**说明**']);
});
