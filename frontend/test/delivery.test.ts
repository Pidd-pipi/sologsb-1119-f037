import 'fake-indexeddb/auto';
import { db, ensureSeedData } from '../src/utils/db';
import { useSpecimenStore } from '../src/stores/specimenStore';
import { useProcedureStore } from '../src/stores/procedureStore';
import { checkDeliveryBlockers } from '../src/utils/delivery';
import type { PrepProcedure } from '../src/types/procedure';

const results: string[] = [];
function check(name: string, ok: boolean, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function mkProc(over: Partial<PrepProcedure>): PrepProcedure {
  return {
    id: Math.random().toString(36).slice(2),
    specimenId: 's1',
    stepType: '清修',
    nodeName: 'n',
    seq: 1,
    tools: [],
    abrasive: '',
    adhesive: '',
    adhesiveConc: 0,
    durationMin: 10,
    tempC: 20,
    rh: 50,
    photoBeforeIds: [],
    photoAfterIds: [],
    operator: 'op',
    startedAt: Date.now(),
    state: 'pending',
    ...over,
  };
}

async function expectThrow(fn: () => Promise<unknown>, part: string) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof Error && e.message.includes(part);
  }
}

(async () => {
  // ---- 1. checkDeliveryBlockers 纯逻辑 ----
  check('无节点 → 卡点 empty', checkDeliveryBlockers([]).some((b) => b.kind === 'empty'));
  check(
    '有待办 → 卡点 pending',
    checkDeliveryBlockers([mkProc({ seq: 1, state: 'done' }), mkProc({ seq: 2, state: 'pending' })]).some(
      (b) => b.kind === 'pending',
    ),
  );
  check(
    '有回退 → 卡点 rolledback',
    checkDeliveryBlockers([mkProc({ seq: 1, state: 'done' }), mkProc({ seq: 2, state: 'rolledback' })]).some(
      (b) => b.kind === 'rolledback',
    ),
  );
  check(
    '序号跳号 → 卡点 gap',
    checkDeliveryBlockers([mkProc({ seq: 1, state: 'done' }), mkProc({ seq: 3, state: 'done' })]).some(
      (b) => b.kind === 'gap',
    ),
  );
  check(
    '全部完成且连续 → 无卡点',
    checkDeliveryBlockers([mkProc({ seq: 1, state: 'done' }), mkProc({ seq: 2, state: 'done' })]).length === 0,
  );

  // ---- 2. 种子数据：3 件标本，第 3 件已交付归档 ----
  await ensureSeedData();
  const specimens = await db.specimens.toArray();
  check('种子数据 3 件标本', specimens.length === 3, `got ${specimens.length}`);
  const archived = specimens.find((s) => s.status === '已交付');
  assert(!!archived, '应存在已交付种子标本');
  check('归档种子有交付人', archived!.deliveredBy === '林砚秋');
  check('归档种子有接收单位', archived!.receivingUnit === '古哺乳动物研究室');
  check('归档种子有交接时间', typeof archived!.deliveredAt === 'number');
  const archivedProcs = await db.procedures.where('specimenId').equals(archived!.id).toArray();
  check('归档种子工序全部 done', archivedProcs.every((p) => p.state === 'done'), `count=${archivedProcs.length}`);

  // ---- 3. store 层：在修标本交付全流程 ----
  await useSpecimenStore.getState().load();
  await useProcedureStore.getState().load();

  const specStore = useSpecimenStore.getState;
  const procStore = useProcedureStore.getState;
  const specItems = () => specStore().items;
  const noProcSpec = specItems().find((s) => s.specimenNo === 'FP-2024-0058')!;
  check('找到未交付标本 0058', !!noProcSpec);
  check(
    '无工序标本 deliver 被拒',
    await expectThrow(
      () =>
        specStore().deliver(noProcSpec.id, {
          deliveredBy: 'a',
          receivingUnit: 'b',
          deliveredAt: Date.now(),
        }),
      '尚无任何工序节点',
    ),
  );

  // 给 0058 追加一道工序（pending），交付应被「待办」拦截
  await procStore().add({
    specimenId: noProcSpec.id,
    stepType: '清修',
    nodeName: '粗清',
    seq: 1,
    tools: ['剔针'],
    abrasive: '',
    adhesive: '',
    adhesiveConc: 0,
    durationMin: 30,
    tempC: 22,
    rh: 48,
    photoBeforeIds: [],
    photoAfterIds: [],
    operator: '林砚秋',
    startedAt: Date.now(),
    state: 'pending',
  });
  check(
    '待办未完成 deliver 被拒',
    await expectThrow(
      () => specStore().deliver(noProcSpec.id, { deliveredBy: 'a', receivingUnit: 'b', deliveredAt: Date.now() }),
      '待办节点',
    ),
  );

  // 完成该节点后交付成功
  const theProc = (await db.procedures.where('specimenId').equals(noProcSpec.id).toArray())[0];
  await procStore().finish(theProc.id);
  await specStore().deliver(noProcSpec.id, {
    deliveredBy: '周师傅',
    receivingUnit: '陈列部',
    deliveredAt: 1_700_000_000_000,
  });
  const after = await db.specimens.get(noProcSpec.id);
  check('交付后状态为已交付', after!.status === '已交付');
  check('交付人写入', after!.deliveredBy === '周师傅');
  check('接收单位写入', after!.receivingUnit === '陈列部');
  check('交接时间写入', after!.deliveredAt === 1_700_000_000_000);

  // ---- 4. 归档后所有写操作被拒 ----
  await procStore().load();
  check(
    '归档后追加工序被拒',
    await expectThrow(
      () =>
        procStore().add({
          specimenId: noProcSpec.id,
          stepType: '加固',
          nodeName: 'x',
          seq: 2,
          tools: [],
          abrasive: '',
          adhesive: '',
          adhesiveConc: 0,
          durationMin: 1,
          tempC: 1,
          rh: 1,
          photoBeforeIds: [],
          photoAfterIds: [],
          operator: 'o',
          startedAt: Date.now(),
          state: 'pending',
        }),
      '已交付归档',
    ),
  );
  check('归档后完成节点被拒', await expectThrow(() => procStore().finish(theProc.id), '已交付归档'));
  check('归档后回退节点被拒', await expectThrow(() => procStore().rollback(theProc.id), '已交付归档'));
  check(
    '归档后 update 改资料被拒',
    await expectThrow(() => specStore().update(noProcSpec.id, { storageBox: 'Z 区 9 匣' }), '已交付归档'),
  );
  check(
    '归档后 setStatus 被拒',
    await expectThrow(() => specStore().setStatus(noProcSpec.id, '修复中'), '已交付归档'),
  );
  check(
    '重复交付被拒',
    await expectThrow(
      () => specStore().deliver(noProcSpec.id, { deliveredBy: 'a', receivingUnit: 'b', deliveredAt: 1 }),
      '已交付归档，不能重复交付',
    ),
  );

  // ---- 5. 在修标本不能直接把状态改成已交付 ----
  const midSpec = specItems().find((s) => s.specimenNo === 'FP-2024-0031')!;
  check(
    'setStatus 直接置已交付被拒',
    await expectThrow(() => specStore().setStatus(midSpec.id, '已交付'), '办理交付'),
  );
  check(
    'update 携带已交付状态被拒',
    await expectThrow(() => specStore().update(midSpec.id, { status: '已交付' }), '办理交付'),
  );
  // 在修状态流转仍然可用（未交付标本升级后仍可维护）
  await specStore().setStatus(midSpec.id, '待交付');
  check('未交付标本仍可流转状态', (await db.specimens.get(midSpec.id))!.status === '待交付');

  // ---- 6. 历史归档件（种子 0007）同样只读，且在修标本可继续加工序 ----
  check(
    '历史归档件追加工序被拒',
    await expectThrow(
      () =>
        procStore().add({
          specimenId: archived!.id,
          stepType: '翻模',
          nodeName: 'x',
          seq: 3,
          tools: [],
          abrasive: '',
          adhesive: '',
          adhesiveConc: 0,
          durationMin: 1,
          tempC: 1,
          rh: 1,
          photoBeforeIds: [],
          photoAfterIds: [],
          operator: 'o',
          startedAt: Date.now(),
          state: 'pending',
        }),
      '已交付归档',
    ),
  );

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(failed.length === 0 ? `\nALL PASS (${results.length})` : `\n${failed.length}/${results.length} FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
