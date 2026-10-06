import {
  effectiveEvaluation,
  isReadyForUse,
  listMortarBatches,
  previewBatch,
  CONCLUDED_STATUSES,
  MORTAR_STATUS,
  SNAPSHOT_FIELDS,
} from './mortar-service'
import type { Evaluation } from './policy'
import type { EntryRow } from '@/data/types'

/**
 * 批次展示视图 —— 拌制页、检验入口、同步注浆待用清单共用同一份明细拼装，
 * 任何入口都不再自己解释“合格/废弃/可投用”。
 */
export type BatchView = {
  id: number
  row: EntryRow
  batchNo: string
  slurryType: string
  cementAmount: string
  bentoniteAmount: string
  waterCementRatio: string
  consistency: string
  mixedDate: string
  status: string
  concluded: boolean
  ready: boolean
  /** 定论批次返回当时快照结论；未定论批次返回当前判据预检。 */
  evaluation: Evaluation
  /** 始终按当前判据实时计算，仅用于“若现在送检会怎样”的提示。 */
  currentPreview: Evaluation
  verdictLabel: string
  reason: string
  inspector: string
  inspectedAt: string
  recheckVerdict: string
  recheckReason: string
}

export function toBatchView(row: EntryRow): BatchView {
  const evaluation = effectiveEvaluation(row)
  const concluded = CONCLUDED_STATUSES.has(String(row.status))
  let verdictLabel: string
  if (String(row.status) === MORTAR_STATUS.discarded) {
    verdictLabel = '已废弃'
  } else if (concluded) {
    verdictLabel = evaluation.verdict
  } else {
    verdictLabel = `预检${evaluation.verdict}`
  }
  return {
    id: Number(row.id),
    row,
    batchNo: String(row['批次编号'] ?? ''),
    slurryType: String(row['浆液类型'] ?? ''),
    cementAmount: String(row['水泥用量'] ?? ''),
    bentoniteAmount: String(row['膨润土用量'] ?? ''),
    waterCementRatio: String(row['水灰比'] ?? ''),
    consistency: String(row['稠度'] ?? ''),
    mixedDate: String(row['拌制日期'] ?? ''),
    status: String(row.status),
    concluded,
    ready: isReadyForUse(row),
    evaluation,
    currentPreview: previewBatch(row),
    verdictLabel,
    reason: concluded
      ? String(row[SNAPSHOT_FIELDS.reason] ?? evaluation.reason)
      : evaluation.reason,
    inspector: String(row[SNAPSHOT_FIELDS.inspector] ?? ''),
    inspectedAt: String(row[SNAPSHOT_FIELDS.inspectedAt] ?? ''),
    recheckVerdict: String(row[SNAPSHOT_FIELDS.recheckVerdict] ?? ''),
    recheckReason: String(row[SNAPSHOT_FIELDS.recheckReason] ?? ''),
  }
}

export function listBatchViews(): BatchView[] {
  return listMortarBatches().map(toBatchView)
}

export type MortarCounts = {
  waiting: number
  mixing: number
  passed: number
  rejected: number
  discarded: number
  ready: number
}

export function mortarCounts(views: BatchView[] = listBatchViews()): MortarCounts {
  const count = (status: string) => views.filter((item) => item.status === status).length
  return {
    waiting: count(MORTAR_STATUS.waiting),
    mixing: count(MORTAR_STATUS.mixing),
    passed: count(MORTAR_STATUS.passed),
    rejected: count(MORTAR_STATUS.rejected),
    discarded: count(MORTAR_STATUS.discarded),
    ready: views.filter((item) => item.ready).length,
  }
}
