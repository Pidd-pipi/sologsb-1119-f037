import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { PrepProcedure, PrepProcedureDraft } from '../types/procedure';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  finish: (id: string) => Promise<void>;
  rollback: (id: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
}

/** 归档标本的工序只读：禁止追加、完成、回退 */
async function assertSpecimenOpen(specimenId: string, action: string): Promise<void> {
  const specimen = await db.specimens.get(specimenId);
  if (specimen?.status === '已交付') {
    throw new Error(`标本已交付归档，${action}（工序时间线只读）`);
  }
}

/** 工序本身属于某件已归档标本时同样拒绝写操作 */
function assertProcedureOpen(specimenId: string | undefined, action: string): void {
  if (specimenId === undefined) {
    throw new Error('未找到该工序节点');
  }
}

export const useProcedureStore = create<ProcedureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.procedures.toArray();
    items.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async add(draft) {
    await assertSpecimenOpen(draft.specimenId, '不能追加工序');
    const record: PrepProcedure = { ...draft, id: newId('prc') };
    await db.procedures.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async finish(id) {
    const current = get().items.find((it) => it.id === id);
    assertProcedureOpen(current?.specimenId, '节点不可操作');
    await assertSpecimenOpen(current!.specimenId, '节点不可完成');
    const patch: Partial<PrepProcedure> = { state: 'done', finishedAt: Date.now() };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async rollback(id) {
    const current = get().items.find((it) => it.id === id);
    assertProcedureOpen(current?.specimenId, '节点不可操作');
    await assertSpecimenOpen(current!.specimenId, '节点不可回退');
    const patch: Partial<PrepProcedure> = { state: 'rolledback', finishedAt: undefined };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    await db.procedures.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
