import {
  CURRENT_MORTAR_POLICY,
  evaluateBatch,
  getMortarPolicy,
  type Evaluation,
  type Verdict,
} from './policy'
import { commitRows, listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

/**
 * 浆液批次领域模型：页面/检验/导出/同步注浆都通过这里读写，
 * 任何一处都不允许自己改 status、自己算合格。
 */

export const MORTAR_KEY = 'mortar'

export const MORTAR_STATUS = {
  waiting: '待拌制',
  mixing: '拌制中',
  passed: '检验合格',
  rejected: '检验不合格',
  discarded: '已废弃',
} as const

/** 已定论状态：判据再变，结论也按当时的快照留着，不回改。 */
export const CONCLUDED_STATUSES: ReadonlySet<string> = new Set([
  MORTAR_STATUS.passed,
  MORTAR_STATUS.rejected,
  MORTAR_STATUS.discarded,
])

/** 检验快照字段名（写在批次行上，localStorage 直接可存）。 */
export const SNAPSHOT_FIELDS = {
  verdict: '检验结论',
  reason: '结论说明',
  policyVersion: '判据版本',
  inspector: '检验人员',
  inspectedAt: '检验时间',
  recheckVerdict: '新判据复判',
  recheckReason: '复判说明',
} as const

export type Role = '值班管理员' | '拌制站负责人' | '试验检测员' | '注浆班组'

/** 只有拌制站负责人能废弃批次。 */
export function canDiscard(role: string): boolean {
  return role === '拌制站负责人'
}

/** 提交检验（给出推进结论）由试验检测员或拌制站负责人执行。 */
export function canSubmitInspection(role: string): boolean {
  return role === '试验检测员' || role === '拌制站负责人'
}

/**
 * 读一个批次在【当前判据】下的预检结论。
 * 拌制中/待拌制批次的页面提示、检验入口的明细、导出“当前复判”列都用它。
 */
export function previewBatch(batch: EntryRow): Evaluation {
  return evaluateBatch({
    consistency: batch['稠度'],
    waterCementRatio: batch['水灰比'],
  })
}

/**
 * 读一个批次“投用算不算数”的结论：
 * - 已定论的批次按检验快照（当时判据、当时结论），判据变更不翻案；
 * - 未定论批次按当前判据实时预检。
 * 待用清单、各页合格计数、导出“是否可投用”都以这里为准。
 */
export function effectiveEvaluation(batch: EntryRow): Evaluation {
  const status = String(batch.status)
  if (CONCLUDED_STATUSES.has(status)) {
    const version = String(batch[SNAPSHOT_FIELDS.policyVersion] ?? CURRENT_MORTAR_POLICY.version)
    const verdict = String(batch[SNAPSHOT_FIELDS.verdict] ?? '') as Verdict
    return {
      verdict,
      consistencyCheck: {
        field: '稠度',
        raw: String(batch['稠度'] ?? ''),
        value: null,
        band: getMortarPolicy(version).consistency,
        pass: null,
      },
      ratioCheck: {
        field: '水灰比',
        raw: String(batch['水灰比'] ?? ''),
        value: null,
        band: getMortarPolicy(version).waterCementRatio,
        pass: null,
      },
      reason: String(batch[SNAPSHOT_FIELDS.reason] ?? '沿用检验定论'),
      policyVersion: version,
    }
  }
  return previewBatch(batch)
}

/** 待用清单的唯一口径：检验合格的批次（按当时快照，不被新判据翻案）。 */
export function isReadyForUse(batch: EntryRow): boolean {
  return String(batch.status) === MORTAR_STATUS.passed
}

export function listMortarBatches(): EntryRow[] {
  return listRows(MORTAR_KEY)
}

/** 同步注浆待用清单与拌制页合格计数共用这一份，保证两边是同一个数。 */
export function listReadyBatches(): EntryRow[] {
  return listMortarBatches().filter(isReadyForUse)
}

export type DomainResult = { ok: boolean; message: string }

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function isPositiveAmount(value: string): boolean {
  return value !== '' && Number.isFinite(Number(value)) && Number(value) > 0
}

export type RegisterInput = {
  batchNo: string
  slurryType: string
  cementAmount: string
  bentoniteAmount: string
  waterCementRatio: string
  consistency: string
  mixedDate: string
  role: string
}

/**
 * 登记批次。反复提交只入一条（按批次编号幂等）；任何一项校验不过都不写库，
 * 由 commitRows 保证序列化失败时旧数据原样保留——入库失败一律不落。
 */
export function registerBatch(input: RegisterInput): DomainResult {
  const batchNo = input.batchNo.trim()
  const slurryType = input.slurryType.trim()
  const cement = input.cementAmount.trim()
  const bentonite = input.bentoniteAmount.trim()
  const ratio = input.waterCementRatio.trim()
  const consistency = input.consistency.trim()
  const mixedDate = input.mixedDate.trim()

  const validations: Array<[boolean, string]> = [
    [batchNo !== '', '批次编号不能为空'],
    [slurryType !== '', '浆液类型不能为空'],
    [isPositiveAmount(cement), '水泥用量需为正数'],
    [isPositiveAmount(bentonite), '膨润土用量需为正数'],
    [isValidDate(mixedDate), '拌制日期需为 YYYY-MM-DD'],
    [mixedDate <= '2026-10-06', '拌制日期不能晚于今天'],
  ]
  const failed = validations.find(([pass]) => !pass)
  if (failed) {
    return { ok: false, message: failed[1] }
  }

  const rows = listMortarBatches()
  if (rows.some((row) => String(row['批次编号']) === batchNo)) {
    return { ok: false, message: `批次 ${batchNo} 已登记，重复提交未重复入库` }
  }

  const batch: EntryRow = {
    id: nextId(rows),
    status: MORTAR_STATUS.waiting,
    pending: true,
    abnormal: false,
    批次编号: batchNo,
    浆液类型: slurryType,
    水泥用量: `${cement} kg`,
    膨润土用量: `${bentonite} kg`,
    水灰比: ratio,
    稠度: consistency ? `${consistency} mm` : '',
    拌制日期: mixedDate,
    批次状态: MORTAR_STATUS.waiting,
  }

  return commitRows(MORTAR_KEY, [...rows, batch])
    ? { ok: true, message: `批次 ${batchNo} 已登记（待拌制）` }
    : { ok: false, message: '入库失败，批次未登记，原有数据保持不变' }
}

/** 开始拌制：待拌制 → 拌制中。重复点只拦不报错成异常。 */
export function startMixing(id: number): DomainResult {
  const rows = listMortarBatches()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的浆液批次` }
  }
  const current = String(rows[index].status)
  if (current !== MORTAR_STATUS.waiting) {
    return { ok: false, message: `批次当前为「${current}」，不能开始拌制` }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: MORTAR_STATUS.mixing,
    批次状态: MORTAR_STATUS.mixing,
    pending: true,
  }
  const next = [...rows]
  next[index] = updated
  return commitRows(MORTAR_KEY, next)
    ? { ok: true, message: '批次已开始拌制' }
    : { ok: false, message: '入库失败，状态未变更' }
}

/**
 * 提交检验 —— 检验入口的唯一推进动作，结论来自 policy.ts 的统一引擎。
 * 已定论批次重复提交一律幂等拦下；越权（非检测人员）当场拒绝，不进库。
 */
export function submitInspection(
  id: number,
  role: string,
  inspector: string,
  now: string = new Date().toISOString(),
): DomainResult {
  if (!canSubmitInspection(role)) {
    return { ok: false, message: `当前角色「${role}」无权提交检验，仅试验检测员/拌制站负责人可操作` }
  }
  const rows = listMortarBatches()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的浆液批次` }
  }
  const batch = rows[index]
  const current = String(batch.status)
  if (current === MORTAR_STATUS.passed || current === MORTAR_STATUS.rejected) {
    return { ok: false, message: `批次已有检验定论「${current}」，重复提交未重复入库` }
  }
  if (current === MORTAR_STATUS.discarded) {
    return { ok: false, message: '批次已废弃，不能再提交检验' }
  }

  const evaluation = previewBatch(batch)
  const target = evaluation.verdict === '合格' ? MORTAR_STATUS.passed : MORTAR_STATUS.rejected
  const updated: EntryRow = {
    ...batch,
    status: target,
    批次状态: target,
    pending: false,
    abnormal: target === MORTAR_STATUS.rejected,
    [SNAPSHOT_FIELDS.verdict]: evaluation.verdict,
    [SNAPSHOT_FIELDS.reason]: evaluation.reason,
    [SNAPSHOT_FIELDS.policyVersion]: evaluation.policyVersion,
    [SNAPSHOT_FIELDS.inspector]: inspector || role,
    [SNAPSHOT_FIELDS.inspectedAt]: now,
  }
  const next = [...rows]
  next[index] = updated
  if (!commitRows(MORTAR_KEY, next)) {
    return { ok: false, message: '入库失败，检验结论未落库，批次维持原状态' }
  }
  return {
    ok: true,
    message:
      target === MORTAR_STATUS.passed
        ? `检验合格（判据 ${evaluation.policyVersion}）：${evaluation.reason}，批次已进入待用清单`
        : `检验${evaluation.verdict}（判据 ${evaluation.policyVersion}）：${evaluation.reason}`,
  }
}

/**
 * 废弃批次 —— 只允许拌制站负责人。越权在领域层当场拦下，页面按钮也会隐藏，双保险。
 */
export function discardBatch(id: number, role: string): DomainResult {
  if (!canDiscard(role)) {
    return { ok: false, message: `越权拦截：只有拌制站负责人能废弃批次，当前角色「${role}」的提交已拒绝` }
  }
  const rows = listMortarBatches()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的浆液批次` }
  }
  const current = String(rows[index].status)
  if (current === MORTAR_STATUS.discarded) {
    return { ok: false, message: '批次已废弃，无需重复操作' }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: MORTAR_STATUS.discarded,
    批次状态: MORTAR_STATUS.discarded,
    pending: false,
    abnormal: true,
  }
  const next = [...rows]
  next[index] = updated
  return commitRows(MORTAR_KEY, next)
    ? { ok: true, message: '批次已废弃' }
    : { ok: false, message: '入库失败，废弃未生效' }
}

export type ReapplyStats = {
  reevaluated: number
  kept: number
  version: string
}

/**
 * 判据变更后，把已登记批次重新过一遍：
 * - 未定论批次：按当前判据预检并标注复判结论（状态仍停在待拌制/拌制中，等检验动作定论）；
 * - 已定论批次：早先结论按当时判据原样保留，只追加“新判据复判”信息供参考，不回改状态。
 */
export function reapplyPolicy(now: string = new Date().toISOString()): ReapplyStats {
  const rows = listMortarBatches()
  let reevaluated = 0
  let kept = 0
  const next = rows.map((row) => {
    const preview = previewBatch(row)
    if (CONCLUDED_STATUSES.has(String(row.status))) {
      kept += 1
      // 结论版本若已等于当前版本，不重复刷复判信息。
      if (String(row[SNAPSHOT_FIELDS.policyVersion] ?? '') === CURRENT_MORTAR_POLICY.version) {
        return row
      }
      return {
        ...row,
        [SNAPSHOT_FIELDS.recheckVerdict]: preview.verdict,
        [SNAPSHOT_FIELDS.recheckReason]: `判据 ${CURRENT_MORTAR_POLICY.version} 复判：${preview.reason}；原结论按判据 ${
          row[SNAPSHOT_FIELDS.policyVersion] ?? '未知版本'
        } 保留（${now.slice(0, 10)} 复判）`,
      }
    }
    reevaluated += 1
    return {
      ...row,
      [SNAPSHOT_FIELDS.recheckVerdict]: preview.verdict,
      [SNAPSHOT_FIELDS.recheckReason]: `判据 ${CURRENT_MORTAR_POLICY.version} 预检：${preview.reason}（${now.slice(0, 10)}）`,
    }
  })
  commitRows(MORTAR_KEY, next)
  return { reevaluated, kept, version: CURRENT_MORTAR_POLICY.version }
}
