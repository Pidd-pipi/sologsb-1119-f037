import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { checkDeliveryBlockers } from '../utils/delivery';
import type { Specimen, SpecimenDraft, SpecimenStatus } from '../types/specimen';

export interface DeliveryInput {
  deliveredBy: string;
  receivingUnit: string;
  deliveredAt: number;
}

interface SpecimenState {
  items: Specimen[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: SpecimenDraft) => Promise<Specimen>;
  update: (id: string, patch: Partial<Specimen>) => Promise<void>;
  setStatus: (id: string, status: SpecimenStatus) => Promise<void>;
  /** 统一交付入口：核查卡点、登记交接信息并归档（状态置为已交付） */
  deliver: (id: string, input: DeliveryInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** 归档后的标本禁止再改资料（交接信息除外，由 deliver 在归档当时写入） */
function assertNotArchived(record: Specimen | undefined, action: string): asserts record is Specimen {
  if (record && record.status === '已交付') {
    throw new Error(`标本已交付归档，${action}（档案只读）`);
  }
}

export const useSpecimenStore = create<SpecimenState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  async load() {
    set({ loading: true });
    const items = await db.specimens.orderBy('createdAt').reverse().toArray();
    set({ items, loading: false, loaded: true });
  },
  async add(draft) {
    const record: Specimen = { ...draft, id: newId('spm'), createdAt: Date.now() };
    await db.specimens.put(record);
    set({ items: [record, ...get().items] });
    return record;
  },
  async update(id, patch) {
    const current = get().items.find((it) => it.id === id);
    assertNotArchived(current, '资料不可修改');
    // 已交付状态不允许通过普通更新写入，只能走 deliver 交付入口
    if (patch.status === '已交付') {
      throw new Error('请从「办理交付」入口完成交付');
    }
    await db.specimens.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async setStatus(id, status) {
    if (status === '已交付') {
      throw new Error('请从「办理交付」入口完成交付');
    }
    await get().update(id, { status });
  },
  async deliver(id, input) {
    const current = get().items.find((it) => it.id === id);
    if (!current) throw new Error('未找到该标本');
    if (current.status === '已交付') {
      throw new Error('该标本已交付归档，不能重复交付');
    }
    // 入口统一核查：仍有待办 / 回退 / 空节点 / 跳号时拒绝归档
    const procedures = await db.procedures.where('specimenId').equals(id).toArray();
    const blockers = checkDeliveryBlockers(procedures);
    if (blockers.length > 0) {
      throw new Error(blockers[0].message);
    }
    const patch: Partial<Specimen> = {
      status: '已交付',
      deliveredBy: input.deliveredBy,
      receivingUnit: input.receivingUnit,
      deliveredAt: input.deliveredAt,
    };
    await db.specimens.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    await db.specimens.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
}));
