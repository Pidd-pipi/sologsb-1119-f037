/** 标本状态 */
export type SpecimenStatus = '待清修' | '修复中' | '已加固' | '待交付' | '已交付';

export const SPECIMEN_STATUSES: SpecimenStatus[] = [
  '待清修',
  '修复中',
  '已加固',
  '待交付',
  '已交付',
];

/** 办理交付前可流转的在修状态（「已交付」只能由交付入口写入） */
export const OPEN_SPECIMEN_STATUSES: SpecimenStatus[] = SPECIMEN_STATUSES.filter(
  (s) => s !== '已交付',
);

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
  /** 交付人（v3，交付时登记） */
  deliveredBy?: string;
  /** 接收单位（v3，交付时登记） */
  receivingUnit?: string;
  /** 交接时间戳（v3，交付时登记） */
  deliveredAt?: number;
  createdAt: number;
}

export type SpecimenDraft = Omit<Specimen, 'id' | 'createdAt'>;

/** 是否已交付归档：归档后标本、工序与时间线只读 */
export function isSpecimenArchived(specimen: Pick<Specimen, 'status'>): boolean {
  return specimen.status === '已交付';
}
