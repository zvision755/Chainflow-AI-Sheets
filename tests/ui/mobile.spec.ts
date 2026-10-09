import { test, expect, type Page } from '@playwright/test';
import { emptyCell, newColumn, type Sheet } from '../../core/types';
import { defaultRunOptions } from '../../core/run-settings';
import { serialize } from '../../core/storage';

function fixture(rows = 2): Sheet {
  const columns = [newColumn('a', '原始内容', []), newColumn('b', '整理', ['a']), newColumn('c', '解读', ['b']), newColumn('d', '摘要', ['c'])];
  columns.forEach(column => column.prompt = '按照列要求处理来源内容');
  return { version: 1, name: '移动工作流验收', columns, rows: Array.from({ length: rows }, (_, index) => ({ id: `row-${index + 1}`, cells: Object.fromEntries(columns.map((column, i) => [column.id, emptyCell(i === 0 ? `记录 ${index + 1}` : '', i === 0 ? 'done' : 'idle')])) })) };
}
async function open(page: Page, sheet = fixture()) {
  await page.addInitScript(({ sheet, options }) => {
    if (!localStorage.getItem('chainflow-workspace-v1')) localStorage.setItem('chainflow-workspace-v1', JSON.stringify({ version: 1, activeId: 'test-sheet', tables: [{ id: 'test-sheet', sheet, options }] }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copied = text; } } });
  }, { sheet, options: { ...defaultRunOptions, autoRetry: false, dependencyDelayMs: 0 } });
  await page.route('**/api/capabilities', route => route.fulfill({ json: { codex: false, tts: true, builtinTts: true } }));
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-view', 'mobile');
}
async function connect(page: Page) {
  await page.getByLabel('查看连接状态', { exact: true }).click();
  await page.getByRole('button', { name: '查看连接设置', exact: true }).click();
  await page.getByLabel('API key', { exact: true }).fill('sk-simulated-mobile-test-key');
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
async function view(page: Page, label: string) {
  await page.getByLabel('应用菜单', { exact: true }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}
test('two-line overview opens every column, highlights clicked C, copies full long text, and navigates rows', async ({ page }) => {
  const sheet = fixture(), full = '长文本解读，保留全部内容。\n'.repeat(300);
  sheet.rows[0].cells.c = emptyCell(full, 'done'); sheet.rows[0].height = 800;
  await open(page, sheet);
  await expect(page.locator('.row-resize-handle')).toHaveCount(0);
  const preview = page.getByRole('button', { name: '查看第 1 行 解读', exact: true }).locator('.mobile-cell-preview');
  expect((await preview.innerText()).length).toBeLessThanOrEqual(601);
  expect(await preview.evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe('2');
  expect(await preview.evaluate(node => node.closest('tr')!.getBoundingClientRect().height)).toBeLessThanOrEqual(76);
  expect(await preview.evaluate(node => getComputedStyle(node).overflow)).toBe('hidden');
  await page.getByRole('button', { name: '查看第 1 行 解读', exact: true }).click();
  const detail = page.locator('.row-detail-sheet');
  await expect(detail.locator('.row-detail-card')).toHaveCount(4);
  await expect(detail.locator('[data-column-id="c"]')).toHaveClass(/selected-column/);
  await expect(detail.locator('[data-column-id="c"] .row-card-text')).toHaveText(full);
  await page.screenshot({ path: `outputs/mobile-detail-${test.info().project.name}.png` });
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.getByRole('button', { name: '复制第 1 行 解读', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copied)).toBe(full);
  await page.getByRole('button', { name: '下一行', exact: true }).click();
  await expect(page.getByRole('heading', { name: /第 2 行/ })).toBeVisible();
  await expect(detail.locator('[data-column-id="a"] .row-card-text')).toHaveText('记录 2');
  await page.getByRole('button', { name: '关闭行详情', exact: true }).click();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.screenshot({ path: `outputs/mobile-overview-${test.info().project.name}.png` });
});
test('new row starts from B, keeps sheet open and receives actual dependency output through the shared engine', async ({ page }) => {
  const calls: any[] = [];
  await page.route('**/api/generate', async route => { const request = route.request().postDataJSON(); calls.push(request); await route.fulfill({ json: { text: request.input + ' → 输出', usage: { input: 1, output: 2 } } }); });
  await open(page, fixture(0)); await connect(page);
  await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 整理', { exact: true }).fill('念のため、もう一度確認します。');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.getByRole('heading', { name: /第 1 行/ })).toBeVisible();
  await expect(page.locator('[data-column-id="d"] .row-card-text')).toHaveText('念のため、もう一度確認します。 → 输出 → 输出');
  await expect(page.locator('[data-column-id="b"] .row-card-text')).toHaveText('念のため、もう一度確認します。');
  expect(calls).toHaveLength(2); expect(calls[1].input).toBe(calls[0].input + ' → 输出');
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.getByTestId('running-count')).toBeEmpty();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '查看第 1 行 原始内容', exact: true })).toContainText('点击填写内容');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chainflow-workspace-v1')!).tables[0].sheet.rows.length)).toBe(1);
});
test('continuous entry saves on next without running, retains preferred B, and closes with a saved draft', async ({ page }) => {
  const calls: any[] = [];
  await page.route('**/api/generate', async route => { calls.push(route.request().postDataJSON()); await route.fulfill({ json: { text: '不应生成' } }); });
  await open(page, fixture(0)); await page.getByRole('button', { name: '新增一行', exact: true }).click();
  for (const value of ['第一句', '第二句', '第三句']) {
    await page.getByLabel('填写 整理', { exact: true }).fill(value);
    await page.getByRole('button', { name: '下一行', exact: true }).click();
    await expect(page.getByRole('heading', { name: '新建行', exact: true })).toBeVisible();
    await expect(page.getByLabel('填写 整理', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('填写 整理', { exact: true })).toBeFocused();
  }
  await page.getByRole('button', { name: '下一行', exact: true }).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(3);
  await page.getByLabel('填写 整理', { exact: true }).fill('第四句');
  await page.getByRole('button', { name: '关闭行详情', exact: true }).click();
  await expect(page.locator('.row-detail-sheet')).toHaveCount(0);
  expect(calls).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chainflow-workspace-v1')!).tables[0].sheet.rows.map((row: any) => row.cells.b.value))).toEqual(['第一句', '第二句', '第三句', '第四句']);
  const ids = await page.locator('.mobile-table tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')));
  expect(new Set(ids).size).toBe(4);
});
test('closing details and switching UI during execution preserves tasks, content and preference without extra calls', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(done => release = done), calls: any[] = [];
  await page.route('**/api/generate', async route => { const body = route.request().postDataJSON(); calls.push(body); if (calls.length === 1) await gate; await route.fulfill({ json: { text: body.input + '生成', usage: { input: 1, output: 1 } } }); });
  await open(page, fixture(1)); await connect(page);
  await page.getByRole('button', { name: '查看第 1 行 原始内容', exact: true }).click();
  await page.getByRole('button', { name: '运行', exact: true }).click(); await expect.poll(() => calls.length).toBe(1);
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await view(page, '电脑版'); await expect(page.locator('.app-shell')).toHaveAttribute('data-view', 'desktop');
  await expect(page.getByLabel('第 1 行 原始内容', { exact: true })).toHaveValue('记录 1');
  await expect(page.getByTestId('running-count')).toContainText('正在生成 1 个');
  await view(page, '手机版'); release();
  await expect(page.getByRole('button', { name: '查看第 1 行 摘要', exact: true })).toContainText('记录 1生成生成生成');
  expect(calls).toHaveLength(3);
  await page.reload(); await expect(page.locator('.app-shell')).toHaveAttribute('data-view', 'mobile');
  expect(calls).toHaveLength(3);
  await view(page, '自动适配'); await page.setViewportSize({ width: 900, height: 430 });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-view', 'desktop');
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('.app-shell')).toHaveAttribute('data-view', 'mobile');
});
test('history and autosaved editing reuse downstream invalidation; dirty new entries can be saved on close', async ({ page }) => {
  const sheet = fixture(1); sheet.rows[0].cells.b = { ...emptyCell('第二版', 'done'), history: ['第一版', '第二版'], historyIndex: 1 };
  sheet.rows[0].cells.c = emptyCell('旧解读', 'done');
  await open(page, sheet);
  await page.getByRole('button', { name: '查看第 1 行 整理', exact: true }).click();
  await page.getByLabel('更多 整理 操作', { exact: true }).click();
  await page.getByRole('button', { name: '上一条历史 第 1 行 整理' }).click();
  await expect(page.locator('[data-column-id="b"] .row-card-text')).toHaveText('第一版');
  await expect(page.locator('[data-column-id="c"] .mobile-status-icon')).toHaveAttribute('aria-label', '需要更新');
  await page.getByRole('button', { name: '编辑 整理', exact: true }).click();
  await page.getByLabel('填写 整理', { exact: true }).fill('手动更新');
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.getByRole('button', { name: '查看第 1 行 整理', exact: true })).toContainText('手动更新');
  await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 解读', { exact: true }).fill('从 C 开始');
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '查看第 2 行 解读', exact: true })).toContainText('从 C 开始');
});
test('large table top/bottom navigation restores scroll and view changes do not alter desktop row height', async ({ page }) => {
  const sheet = fixture(100); sheet.rows[0].height = 650;
  await open(page, sheet);
  await page.getByRole('button', { name: '跳转到表格底部' }).click();
  const scroller = page.getByTestId('mobile-table-scroll');
  expect(await scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(1000);
  await scroller.evaluate(node => node.scrollLeft = 130);
  await page.getByRole('button', { name: '查看第 100 行 整理', exact: true }).click();
  await expect(page.getByRole('heading', { name: /第 100 行/ })).toBeVisible();
  const before = await scroller.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }));
  await page.getByRole('button', { name: '关闭行详情' }).click();
  expect(await scroller.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }))).toEqual(before);
  await page.getByRole('button', { name: '回到表格顶部' }).click(); expect(await scroller.evaluate(node => node.scrollTop)).toBe(0);
  await view(page, '电脑版'); expect(await page.locator('[data-row-id="row-1"]').evaluate(node => (node as HTMLElement).style.height)).toBe('650px');
  await expect(page.locator('.row-resize-handle')).toHaveCount(100);
});
test('double submission creates one record; API error and retry settle correctly without losing the manual start', async ({ page }) => {
  let fail = true, calls = 0;
  await page.route('**/api/generate', async route => { calls++; await route.fulfill(fail ? { status: 401, json: { error: { code: 'invalid_key', message: '测试密钥无效', retryable: false } } } : { json: { text: '恢复输出', usage: { input: 1, output: 1 } } }); });
  await open(page, fixture(0)); await connect(page); await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 整理', { exact: true }).fill('手动 B');
  await page.getByRole('button', { name: '运行', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('[data-column-id="c"]')).toContainText('测试密钥无效');
  await expect(page.locator('[data-column-id="d"]')).toContainText('上游未完成或失败');
  expect(calls).toBe(1); fail = false;
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.locator('[data-column-id="d"] .row-card-text')).toHaveText('恢复输出');
  await expect(page.locator('[data-column-id="b"] .row-card-text')).toHaveText('手动 B');
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(1); expect(calls).toBe(3);
  await expect(page.getByTestId('running-count')).toBeEmpty();
});
test('streaming text stays live through closing the modal and switching views, without submitting another request', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (String(url) !== '/api/generate') return original(url, init);
      (window as any).__streamCalls = ((window as any).__streamCalls ?? 0) + 1;
      const encoder = new TextEncoder();
      const body = new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('data: '+JSON.stringify({ type: 'delta', delta: '正在逐字生成' })+'\n\n'));
        (window as any).__finishStream = () => { controller.enqueue(encoder.encode('data: '+JSON.stringify({ type: 'done', result: { text: '完整流式结果', usage: { input: 2, output: 3 } } })+'\n\n')); controller.close(); };
      }});
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await open(page, fixture(0)); await connect(page); await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 解读', { exact: true }).fill('从 C 开始'); await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.locator('[data-column-id="d"] .row-card-text')).toHaveText('正在逐字生成');
  await page.getByRole('button', { name: '关闭行详情' }).click(); await view(page, '电脑版');
  await expect(page.getByLabel('第 1 行 摘要', { exact: true })).toHaveValue('正在逐字生成');
  await view(page, '手机版'); await page.getByRole('button', { name: '查看第 1 行 摘要', exact: true }).click();
  await expect(page.locator('[data-column-id="d"] .row-card-text')).toHaveText('正在逐字生成');
  await page.evaluate(() => (window as any).__finishStream());
  await expect(page.locator('[data-column-id="d"] .row-card-text')).toHaveText('完整流式结果');
  expect(await page.evaluate(() => (window as any).__streamCalls)).toBe(1);
});
test('network failure and stopping an active row never leave a running counter or overwrite a manual seed', async ({ page }) => {
  await page.route('**/api/generate', route => route.abort('failed'));
  await open(page, fixture(0)); await connect(page); await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 解读', { exact: true }).fill('手动 C'); await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.locator('[data-column-id="d"]')).toContainText('无法连接本站服务端');
  await page.unroute('**/api/generate');
  await page.route('**/api/generate', async route => { await new Promise(resolve => setTimeout(resolve, 800)); await route.fulfill({ json: { text: '应被取消的结果', usage: { input: 1, output: 1 } } }).catch(() => {}); });
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByLabel('更多行操作', { exact: true }).click();
  await page.getByRole('button', { name: '停止全部任务', exact: true }).click();
  await expect(page.locator('[data-column-id="d"] .mobile-status-icon')).toHaveAttribute('aria-label', /已取消/);
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.getByTestId('running-count')).toBeEmpty();
  await page.waitForTimeout(900);
  await expect(page.getByRole('button', { name: '查看第 1 行 解读', exact: true })).toContainText('手动 C');
  await expect(page.getByRole('button', { name: '查看第 1 行 摘要', exact: true })).not.toContainText('应被取消的结果');
});
test('detail speech reuses the existing TTS request and stop control', async ({ page }) => {
  const sheet = fixture(1); sheet.columns[1].ttsLanguage = 'ja'; sheet.rows[0].cells.b = emptyCell('念のため、もう一度確認します。', 'done');
  await page.addInitScript(() => { (window as any).Audio = class { src = ''; onended = null; onerror = null; play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} }; });
  let speech: any;
  await page.route('**/api/local-tts/speech', async route => { speech = route.request().postDataJSON(); await route.fulfill({ body: Buffer.from('RIFF-test-audio'), contentType: 'audio/wav' }); });
  await open(page, sheet); await page.getByRole('button', { name: '查看第 1 行 整理', exact: true }).click();
  const speak = page.getByRole('button', { name: '朗读第 1 行 整理', exact: true });
  await speak.click(); await expect(speak.locator('svg')).toHaveClass(/lucide-square/);
  expect(speech.input).toBe('念のため、もう一度確認します。'); expect(speech.language).toBe('ja');
  await speak.click(); await expect(speak.locator('svg')).toHaveClass(/lucide-volume-2/);
});

test('missing sources are explained inside details while retaining a saved arbitrary-column entry', async ({ page }) => {
  const sheet = fixture(0);
  sheet.columns[2].sources = ['a', 'b'];
  let calls = 0;
  await page.route('**/api/generate', route => { calls++; return route.fulfill({ json: { text: '不应生成' } }); });
  await open(page, sheet);
  await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 整理', { exact: true }).fill('只填写 B，A 保持空白');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.locator('.row-detail-sheet [role="alert"]')).toContainText('缺少可用来源');
  await expect(page.locator('[data-column-id="b"] .row-card-text')).toHaveText('只填写 B，A 保持空白');
  expect(calls).toBe(0);
  await page.getByRole('button', { name: '关闭行详情', exact: true }).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(1);
});

test('portrait layout keeps navigation, title, headers, rows and short detail cards compact', async ({ page }) => {
  await open(page, fixture(8));
  const layout = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return { viewport: innerHeight, header: box('.mobile-view .header').height, firstRowTop: box('.mobile-table tbody tr').top,
      rowHeight: box('.mobile-table tbody tr').height, columnHeight: box('.mobile-table th').height };
  });
  expect(layout.header).toBeLessThanOrEqual(74);
  expect(layout.firstRowTop / layout.viewport).toBeLessThan(0.35);
  expect(layout.columnHeight).toBeLessThanOrEqual(50);
  expect(layout.rowHeight).toBeLessThanOrEqual(76);
  await expect(page.locator('.mobile-table th').nth(2)).not.toContainText('来源');
  await expect(page.locator('.mobile-table th').nth(2)).not.toContainText('模型');
  await page.getByLabel('设置 整理', { exact: true }).click();
  await expect(page.getByRole('button', { name: '运行列 整理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await expect(page.getByRole('group', { name: '来源列' })).toBeVisible();
  await expect(page.getByLabel('模型名称', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭列配置' }).click();
  await page.getByRole('button', { name: '查看第 1 行 原始内容', exact: true }).click();
  expect(await page.locator('[data-column-id="a"]').evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(130);
  await page.locator('[data-column-id="a"] .mobile-status-details summary').click();
  await expect(page.locator('[data-column-id="a"] .mobile-status-popover')).toHaveText('完成');
  await expect(page.locator('.row-detail-footer button')).toHaveCount(1);
  await expect(page.locator('.row-detail-footer button')).toHaveText('运行');
});

test('last row next stays disabled; plus opens draft, blank close adds nothing and filled close saves', async ({ page }) => {
  await open(page, fixture(1));
  await page.getByRole('button', { name: '查看第 1 行 原始内容', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一行', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '新增行', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新建行' })).toBeVisible();
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 解读', { exact: true }).fill('从 C 列输入');
  await page.getByRole('button', { name: '新增行', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新建行' })).toBeVisible();
  await expect(page.getByLabel('填写 解读', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '查看第 2 行 解读', exact: true })).toContainText('从 C 列输入');
});

test('failed draft persistence keeps the draft visible and retry saves one row', async ({ page }) => {
  await open(page, fixture(0));
  await page.getByRole('button', { name: '新增一行', exact: true }).click();
  await page.getByLabel('填写 整理', { exact: true }).fill('必须保留的草稿');
  await page.evaluate(() => {
    (window as any).__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'chainflow-workspace-v1') throw new DOMException('磁盘空间不足', 'QuotaExceededError');
      return (window as any).__originalSetItem.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败');
  await expect(page.getByLabel('填写 整理', { exact: true })).toHaveValue('必须保留的草稿');
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(0);
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__originalSetItem; });
  await page.getByRole('button', { name: '关闭行详情' }).click();
  await expect(page.locator('.row-detail-sheet')).toHaveCount(0);
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(1);
});
test('detail plus inserts after row 10 and continuous drafts retain order; overview still appends',async({page})=>{
  const sheet=fixture(65);sheet.rows[10].cells.b=emptyCell('保留的原输出','done');
  await open(page,sheet);
  const original=JSON.parse(serialize(sheet)).rows[10];
  await page.getByRole('button',{name:'查看第 10 行 原始内容',exact:true}).click();
  await page.getByRole('button',{name:'新增行',exact:true}).click();
  await page.getByRole('button',{name:'关闭行详情',exact:true}).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(65);
  await page.getByRole('button',{name:'查看第 10 行 原始内容',exact:true}).click();
  await page.getByRole('button',{name:'新增行',exact:true}).click();
  await page.getByLabel('填写 原始内容',{exact:true}).fill('備える');
  await page.getByRole('button',{name:'下一行',exact:true}).click();
  await page.getByLabel('填写 原始内容',{exact:true}).fill('続ける');
  await page.getByRole('button',{name:'下一行',exact:true}).click();
  await page.getByLabel('填写 原始内容',{exact:true}).fill('終える');
  await page.getByRole('button',{name:'关闭行详情',exact:true}).click();
  await expect(page.locator('.mobile-table tbody tr')).toHaveCount(68);
  const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('chainflow-workspace-v1')!).tables[0].sheet.rows);
  expect(rows.slice(10,13).map((row:any)=>row.cells.a.value)).toEqual(['備える','続ける','終える']);
  expect(rows[13]).toEqual(original);
  await page.getByRole('button',{name:'新增一行',exact:true}).click();
  await page.getByLabel('填写 原始内容',{exact:true}).fill('总览末尾');
  await page.getByRole('button',{name:'关闭行详情',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chainflow-workspace-v1')!).tables[0].sheet.rows.at(-1).cells.a.value)).toBe('总览末尾');
});
test('inserted draft runs on row 2 and preserves row 3',async({page})=>{
  await page.route('**/api/generate',route=>route.fulfill({json:{text:route.request().postDataJSON().input+'输出',usage:{input:1,output:1}}}));
  await open(page);await connect(page);
  await page.getByRole('button',{name:'查看第 1 行 原始内容',exact:true}).click();
  await page.getByRole('button',{name:'新增行',exact:true}).click();
  await page.getByLabel('填写 解读',{exact:true}).fill('插入来源');
  await page.getByRole('button',{name:'运行',exact:true}).click();
  await expect(page.getByRole('heading',{name:'第 2 行',exact:true})).toBeVisible();
  await expect(page.locator('[data-column-id="d"] .row-card-text')).toHaveText('插入来源输出');
  await page.getByRole('button',{name:'下一行',exact:true}).click();
  await expect(page.locator('[data-column-id="a"] .row-card-text')).toHaveText('记录 2');
});
