/* UI 冒烟：jsdom 渲染详情页，验证交付入口卡点 → 交付成功 → 归档只读 */
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/specimens',
  pretendToBeVisual: true,
});
// @ts-expect-error 注入浏览器全局
globalThis.window = dom.window;
// @ts-expect-error 注入浏览器全局
globalThis.document = dom.window.document;
// @ts-expect-error 注入浏览器全局
globalThis.navigator = dom.window.navigator;
// emotion / MUI 在模块初始化时探测这些 DOM 全局
for (const key of [
  'HTMLElement',
  'HTMLAnchorElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'SVGElement',
  'MutationObserver',
  'DocumentFragment',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'CustomEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  // @ts-expect-error 按需拷贝
  if (dom.window[key] !== undefined) globalThis[key] = dom.window[key];
}
// @ts-expect-error React 需要判断
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.matchMedia =
  dom.window.matchMedia ||
  (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));

const results: string[] = [];
function check(name: string, ok: boolean, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
}

const { render, screen, fireEvent, waitFor, within, act } = await import('@testing-library/react');
const React = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { ensureSeedData } = await import('../src/utils/db');
const { useSpecimenStore } = await import('../src/stores/specimenStore');
const { useProcedureStore } = await import('../src/stores/procedureStore');
const { default: SpecimenDetail } = await import('../src/pages/SpecimenDetail');
const { Routes, Route } = await import('react-router-dom');

function renderDetail(id: string) {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [`/specimens/${id}`] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/specimens/:id', element: React.createElement(SpecimenDetail) })),
    ),
  );
}

const flush = () => act(async () => {});

(async () => {
  await ensureSeedData();
  await useSpecimenStore.getState().load();
  await useProcedureStore.getState().load();

  const inRepair = useSpecimenStore.getState().items.find((s) => s.specimenNo === 'FP-2024-0031')!;
  const archivedSeed = useSpecimenStore.getState().items.find((s) => s.specimenNo === 'FP-2024-0007')!;

  // ---- 1. 在修标本：打开交付对话框应列出卡点 ----
  const view = renderDetail(inRepair.id);
  await flush();
  await waitFor(() => screen.getByTestId('open-delivery'));
  check('在修标本显示「办理交付」按钮', !!screen.getByTestId('open-delivery'));
  fireEvent.click(screen.getByTestId('open-delivery'));
  await flush();
  const blockers = await screen.findByTestId('delivery-blockers');
  check('交付对话框列出卡点', blockers.textContent!.includes('待办节点'), blockers.textContent!.slice(0, 60));
  check('卡点时交付人输入禁用', (screen.getByTestId('delivery-by') as HTMLInputElement).disabled);
  fireEvent.click(screen.getByText('知道了，去处理卡点'));
  await flush();

  // ---- 2. 完成待办节点后再交付 ----
  const pendingProc = useProcedureStore.getState().items.find((p) => p.specimenId === inRepair.id && p.state !== 'done')!;
  await act(async () => {
    await useProcedureStore.getState().finish(pendingProc.id);
  });
  fireEvent.click(screen.getByTestId('open-delivery'));
  await flush();
  const ready = await screen.findByTestId('delivery-ready');
  check('全部完成后对话框提示可交付', ready.textContent!.includes('全部工序节点已完成'));

  fireEvent.change(screen.getByTestId('delivery-by'), { target: { value: '林砚秋' } });
  fireEvent.change(screen.getByTestId('delivery-unit'), { target: { value: '古哺乳动物研究室' } });
  fireEvent.click(screen.getByText('确认交付并归档'));
  await flush();
  await waitFor(() => screen.getByTestId('handover-card'));

  const handover = screen.getByTestId('handover-card');
  check('归档后展示交接信息卡', handover.textContent!.includes('交付人：林砚秋'));
  check('交接信息含接收单位', handover.textContent!.includes('接收单位：古哺乳动物研究室'));
  check('交接信息含交接时间', handover.textContent!.includes('交接时间：'));
  check('归档后只读横幅', !!screen.getByText(/交付归档，标本资料、工序与时间线仅可查看/));
  const addBtn = screen.getByText('追加工序节点').closest('button')!;
  check('归档后追加工序按钮禁用', addBtn.disabled);
  check('归档后时间线无完成按钮', screen.queryByText('完成节点') === null);
  check('归档后时间线无回退按钮', screen.queryByText('回退节点') === null);
  check('时间线只读标识', !!screen.getByText('档案已归档，工序时间线仅可查看'));
  view.unmount();

  // ---- 3. 历史归档种子件：只读 + 交接信息 ----
  const view2 = renderDetail(archivedSeed.id);
  await flush();
  await waitFor(() => screen.getByTestId('handover-card'));
  check('历史归档件交接信息卡', screen.getByTestId('handover-card').textContent!.includes('林砚秋'));
  check('历史归档件无状态下拉', screen.queryByText('修复状态') === null);
  check('历史归档件追加按钮禁用', screen.getByText('追加工序节点').closest('button')!.disabled);
  view2.unmount();

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(failed.length === 0 ? `\nALL PASS (${results.length})` : `\n${failed.length}/${results.length} FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
