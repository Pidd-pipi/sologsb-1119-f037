/** 标本状态 */
export type SpecimenStatus = '待清修' | '修复中' | '已加固' | '待交付' | '已交付';

export const SPECIMEN_STATUSES: SpecimenStatus[] = [
  '待清修',
  '修复中',
  '已加固',
  '待交付',
  '已交付',
];

/** 交接记录：办理交付时登记，归档后随档案只读 */
export interface HandoverRecord {
  /** 交付人 */
  deliverer: string;
  /** 接收单位 */
  receiver: string;
  /** 交接时间 */
  handoverAt: number;
}

/** 化石标本 */
export interface Specimen {
  id: string;
  /** 标本号 */
  specimenNo: string;
  /** 分类鉴定 */
  taxon: string;
  /** 层位 */
  horizon: string;
  /** 产地 */
  locality: string;
  /** 围岩岩性 */
  lithology: string;
  /** 围岩莫氏硬度 */
  matrixHardness: number;
  /** 尺寸 mm，形如 210×140×60 */
  dimensions: string;
  /** 重量 g */
  weight: number;
  /** 匣位 */
  storageBox: string;
  status: SpecimenStatus;
  /** 交接记录，仅「已交付」标本持有 */
  handover?: HandoverRecord;
  createdAt: number;
}

export type SpecimenDraft = Omit<Specimen, 'id' | 'createdAt' | 'handover'>;

/** 是否已交付归档（归档后标本、工序与时间线仅可查看） */
export function isSpecimenDelivered(specimen: Pick<Specimen, 'status'> | undefined | null): boolean {
  return specimen?.status === '已交付';
}
