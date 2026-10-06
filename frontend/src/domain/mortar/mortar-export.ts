import {
  effectiveEvaluation,
  isReadyForUse,
  listMortarBatches,
  MORTAR_STATUS,
  SNAPSHOT_FIELDS,
} from './mortar-service'
import type { EntryRow } from '@/data/types'

/**
 * 浆液拌制台账导出 —— 拌制页面与检验入口都调这一份。
 * “是否可投用 / 检验结论 / 判据版本”来自统一判定与检验快照，导出环节不再自己判断废弃。
 */

const COLUMNS = [
  '编号',
  '批次编号',
  '浆液类型',
  '水泥用量',
  '膨润土用量',
  '水灰比',
  '稠度',
  '拌制日期',
  '当前状态',
  '检验结论',
  '结论说明',
  '判据版本',
  '是否可投用',
  '新判据复判',
  '检验人员',
  '检验时间',
]

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function concluded(batch: EntryRow): boolean {
  return (
    String(batch.status) === MORTAR_STATUS.passed ||
    String(batch.status) === MORTAR_STATUS.rejected ||
    String(batch.status) === MORTAR_STATUS.discarded
  )
}

export function buildMortarLedger(): { filename: string; content: string; readyCount: number } {
  const batches = listMortarBatches()
  const lines = [COLUMNS.join(',')]
  for (const batch of batches) {
    const evaluation = effectiveEvaluation(batch)
    const isDiscarded = String(batch.status) === MORTAR_STATUS.discarded
    const isConcluded = concluded(batch)
    // 已废弃以状态为准；其余已定论按快照结论；未定论展示当前判据“预检”。措辞统一来自引擎。
    const verdictText = isDiscarded ? '已废弃' : isConcluded ? evaluation.verdict : `预检${evaluation.verdict}`
    const reasonText = isDiscarded
      ? String(batch[SNAPSHOT_FIELDS.reason] ?? '批次已废弃，不进入待用清单')
      : isConcluded
        ? String(batch[SNAPSHOT_FIELDS.reason] ?? evaluation.reason)
        : evaluation.reason
    const policyVersion = isDiscarded
      ? String(batch[SNAPSHOT_FIELDS.policyVersion] ?? evaluation.policyVersion)
      : evaluation.policyVersion
    lines.push(
      [
        batch.id,
        batch['批次编号'],
        batch['浆液类型'],
        batch['水泥用量'],
        batch['膨润土用量'],
        batch['水灰比'],
        batch['稠度'],
        batch['拌制日期'],
        batch.status,
        verdictText,
        reasonText,
        policyVersion,
        isReadyForUse(batch) ? '是' : '否',
        batch[SNAPSHOT_FIELDS.recheckVerdict]
          ? `${String(batch[SNAPSHOT_FIELDS.recheckVerdict])}｜${String(batch[SNAPSHOT_FIELDS.recheckReason] ?? '')}`
          : '',
        batch[SNAPSHOT_FIELDS.inspector] ?? '',
        batch[SNAPSHOT_FIELDS.inspectedAt] ?? '',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return {
    filename: `浆液拌制台账-${new Date().toISOString().slice(0, 10)}.csv`,
    content: `﻿${lines.join('\n')}`,
    readyCount: batches.filter(isReadyForUse).length,
  }
}

export function downloadMortarLedger(): number {
  const { filename, content, readyCount } = buildMortarLedger()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return readyCount
}
