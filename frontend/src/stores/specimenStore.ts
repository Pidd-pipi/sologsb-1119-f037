import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  isSpecimenDelivered,
  type HandoverRecord,
  type Specimen,
  type SpecimenDraft,
  type SpecimenStatus,
} from '../types/specimen';

interface SpecimenState {
  items: Specimen[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: SpecimenDraft) => Promise<Specimen>;
  update: (id: string, patch: Partial<Specimen>) => Promise<void>;
  setStatus: (id: string, status: SpecimenStatus) => Promise<void>;
  /** 交付唯一入口：登记交接记录并把状态置为「已交付」 */
  deliver: (id: string, handover: HandoverRecord) => Promise<void>;
  remove: (id: string) => Promise<void>;
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
    if (isSpecimenDelivered(current)) {
      throw new Error('标本已交付归档，资料仅可查看');
    }
    await db.specimens.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async setStatus(id, status) {
    if (status === '已交付') {
      throw new Error('交付须登记交接信息，请使用「办理交付」入口');
    }
    await get().update(id, { status });
  },
  async deliver(id, handover) {
    const current = get().items.find((it) => it.id === id);
    if (!current) {
      throw new Error('未找到该标本');
    }
    if (isSpecimenDelivered(current)) {
      throw new Error('该标本已交付，请勿重复办理');
    }
    const patch: Partial<Specimen> = { status: '已交付', handover };
    await db.specimens.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    await db.specimens.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
}));
