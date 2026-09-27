import type { PrepProcedure } from '../types/procedure';

export type DeliveryBlockerKind = 'empty' | 'pending' | 'rolledback' | 'gap';

export interface DeliveryBlocker {
  kind: DeliveryBlockerKind;
  /** 面向师傅的卡点说明 */
  message: string;
}

/**
 * 交付前统一卡点核查：
 * - 没有任何工序节点
 * - 存在待办（pending）节点
 * - 存在已回退（rolledback）节点
 * - 工序序号跳号
 * 全部通过才允许办理交付。
 */
export function checkDeliveryBlockers(procedures: PrepProcedure[]): DeliveryBlocker[] {
  const blockers: DeliveryBlocker[] = [];

  if (procedures.length === 0) {
    blockers.push({ kind: 'empty', message: '该标本尚无任何工序节点，无法交付。' });
    return blockers;
  }

  const pending = procedures.filter((p) => p.state === 'pending');
  if (pending.length > 0) {
    blockers.push({
      kind: 'pending',
      message: `仍有 ${pending.length} 个待办节点：${pending
        .map((p) => `#${p.seq} ${p.stepType}·${p.nodeName}`)
        .join('、')}`,
    });
  }

  const rolledback = procedures.filter((p) => p.state === 'rolledback');
  if (rolledback.length > 0) {
    blockers.push({
      kind: 'rolledback',
      message: `仍有 ${rolledback.length} 个已回退节点未重做完成：${rolledback
        .map((p) => `#${p.seq} ${p.stepType}·${p.nodeName}`)
        .join('、')}`,
    });
  }

  const seqs = procedures.map((p) => p.seq);
  const max = Math.max(...seqs);
  const seqSet = new Set(seqs);
  const gaps: number[] = [];
  for (let i = 1; i <= max; i += 1) {
    if (!seqSet.has(i)) gaps.push(i);
  }
  if (gaps.length > 0) {
    blockers.push({ kind: 'gap', message: `工序序号跳号，缺失序号：${gaps.join('、')}` });
  }

  return blockers;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 时间戳 -> 「YYYY-MM-DD HH:mm」 */
export function formatDateTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** 时间戳 -> datetime-local 输入框值「YYYY-MM-DDTHH:mm」 */
export function toDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** datetime-local 输入框值 -> 时间戳；非法值返回 undefined */
export function fromDateTimeLocal(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}
