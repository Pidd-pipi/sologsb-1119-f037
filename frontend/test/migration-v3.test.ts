/* v2 -> v3 迁移验证：历史已交付档案只读、未交付标本升级后可继续维护并办理交付 */
import 'fake-indexeddb/auto';
import { db, DB_NAME, DB_VERSION } from '../src/utils/db';
import { useProcedureStore } from '../src/stores/procedureStore';
import { useSpecimenStore } from '../src/stores/specimenStore';

function createV2Database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const idb = req.result;
      const spm = idb.createObjectStore('specimens', { keyPath: 'id' });
      spm.createIndex('specimenNo', 'specimenNo');
      spm.createIndex('status', 'status');
      spm.createIndex('createdAt', 'createdAt');
      spm.createIndex('taxon', 'taxon');
      spm.createIndex('locality', 'locality');
      const prc = idb.createObjectStore('procedures', { keyPath: 'id' });
      prc.createIndex('specimenId', 'specimenId');
      prc.createIndex('seq', 'seq');
      prc.createIndex('stepType', 'stepType');
      prc.createIndex('state', 'state');
      prc.createIndex('startedAt', 'startedAt');
      idb.createObjectStore('supplies', { keyPath: 'id' });
      idb.createObjectStore('photos', { keyPath: 'id' });

      const tx = req.transaction!;
      const sStore = tx.objectStore('specimens');
      // 老档案 A：v2 时代已被师傅直接标成「已交付」，无任何交接字段
      sStore.put({
        id: 'oldA',
        specimenNo: 'FP-OLD-A',
        taxon: '古鱼类',
        horizon: 'h',
        locality: 'l',
        lithology: '页岩',
        matrixHardness: 3,
        dimensions: '100×80×10',
        weight: 100,
        storageBox: 'A 匣',
        status: '已交付',
        createdAt: 1000,
      });
      // 老档案 B：修复中，无交付字段，升级后要继续能维护
      sStore.put({
        id: 'oldB',
        specimenNo: 'FP-OLD-B',
        taxon: '古哺乳',
        horizon: 'h',
        locality: 'l',
        lithology: '泥岩',
        matrixHardness: 2,
        dimensions: '200×150×80',
        weight: 1500,
        storageBox: 'B 匣',
        status: '修复中',
        createdAt: 2000,
      });
      const pStore = tx.objectStore('procedures');
      pStore.put({
        id: 'pA1',
        specimenId: 'oldA',
        stepType: '清修',
        nodeName: '老节点',
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
        operator: '老师傅',
        startedAt: 1100,
        state: 'done',
        finishedAt: 1200,
      });
      pStore.put({
        id: 'pB1',
        specimenId: 'oldB',
        stepType: '清修',
        nodeName: '待办节点',
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
        operator: '老师傅',
        startedAt: 2100,
        state: 'pending',
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const results: string[] = [];
function check(name: string, ok: boolean, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  check('当前结构版本为 v3', DB_VERSION === 3, `v=${DB_VERSION}`);
  // 关键：先在「别的数据库连接」里造 v2 老数据，再让应用代码以 v3 打开触发迁移
  const v2db = await createV2Database();
  v2db.close();

  // 首次查询触发 v2 -> v3 升级
  const [oldA, oldB] = await Promise.all([db.specimens.get('oldA'), db.specimens.get('oldB')]);

  check('老档案 A 升级后仍为已交付', oldA!.status === '已交付');
  check('老档案 A 交接字段已补齐（空串）', oldA!.deliveredBy === '' && oldA!.receivingUnit === '');
  check('老档案 A 无交接时间', oldA!.deliveredAt === undefined);
  check('老档案 B 升级后仍为修复中', oldB!.status === '修复中');

  // 应用层规则：历史已交付档案只读
  await useSpecimenStore.getState().load();
  await useProcedureStore.getState().load();

  let blocked = false;
  try {
    await useProcedureStore.getState().add({
      specimenId: 'oldA',
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
    });
  } catch (e) {
    blocked = e instanceof Error && e.message.includes('已交付归档');
  }
  check('历史已交付档案升级后仍只读', blocked);

  // 未交付标本升级后可继续维护：完成待办 -> 办理交付成功
  await useProcedureStore.getState().finish('pB1');
  await useSpecimenStore.getState().deliver('oldB', {
    deliveredBy: '新师傅',
    receivingUnit: '标本库',
    deliveredAt: 3_000,
  });
  const bAfter = await db.specimens.get('oldB');
  check('老档案 B 升级后可完成工序并交付', bAfter!.status === '已交付' && bAfter!.deliveredBy === '新师傅');
  check('老档案 B 交接信息齐全', bAfter!.receivingUnit === '标本库' && bAfter!.deliveredAt === 3000);

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(failed.length === 0 ? `\nALL PASS (${results.length})` : `\n${failed.length}/${results.length} FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
