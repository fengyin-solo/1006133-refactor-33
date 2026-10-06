import { getMeta, listRows, saveMany, setMeta } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import { CURRENT_MORTAR_CRITERIA, evaluateMortar, parseMeasure } from './criteria'
import {
  MORTAR_INSPECTION_COLUMNS,
  MORTAR_LEDGER_COLUMNS,
  inspectionDetailRow,
  mortarDetailRow,
  readFrozenSnapshot,
  resolveMortarVerdict,
  usableMortarBatches,
  writeFrozenSnapshot,
} from './ledger'
import { buildLegacyMortarData } from './legacy'
import {
  MORTAR_INSPECTION_KEY,
  MORTAR_MODULE_KEY,
  MORTAR_STATUS,
  type MortarActionResult,
  type MortarBatchInput,
  type MortarInspectionInput,
} from './types'

const LEGACY_META_KEY = 'mortar.legacyVersion'
/** 废弃批次是高风险动作，只放给拌制站负责人；越权在服务层直接拦，页面只做显隐。 */
export const MORTAR_DISCARD_ROLE = '拌制站负责人'

function listMortar(): EntryRow[] {
  return listRows(MORTAR_MODULE_KEY)
}

function listInspections(): EntryRow[] {
  return listRows(MORTAR_INSPECTION_KEY)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function sortedByDate(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const byDate = String(b['拌制日期'] ?? '').localeCompare(String(a['拌制日期'] ?? ''))
    return byDate !== 0 ? byDate : Number(b.id) - Number(a.id)
  })
}

function findBatch(batches: EntryRow[], batchId: number): EntryRow | undefined {
  return batches.find((row) => Number(row.id) === batchId)
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function isLegacyPlaceholder(rows: EntryRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.some((row) => String(row['批次编号'] ?? '').startsWith('MORT-000'))
  )
}

/**
 * 启动补登（幂等）：
 * 1. 首次运行且仍是脚手架样例数据时，按拌制日期补登历史批次与检验记录；
 * 2. 已冻结的老结论不动，未冻结批次的现行判据标记刷新，判据一变自然按新判据重算。
 */
export function bootstrapMortarData(): void {
  if (getMeta(LEGACY_META_KEY) === CURRENT_MORTAR_CRITERIA.version) {
    return
  }
  const existing = listMortar()
  const legacySeed = buildLegacyMortarData()

  let batches: EntryRow[]
  if (existing.length === 0 || isLegacyPlaceholder(existing)) {
    batches = legacySeed.batches
  } else {
    // 老批次按拌制日期补登：批次编号已存在的不重复入，只补齐缺失的。
    const known = new Set(existing.map((row) => String(row['批次编号'] ?? '')))
    const merged = [...existing]
    for (const legacy of legacySeed.batches) {
      if (!known.has(String(legacy['批次编号']))) {
        merged.push({ ...legacy, id: nextId(merged) })
      }
    }
    batches = merged
  }

  // 未冻结批次统一过一遍现行判据标记；冻结批次的 mortarVerdict 原样保留。
  batches = batches.map((row) =>
    readFrozenSnapshot(row)
      ? row
      : { ...row, mortarCriteriaVersion: CURRENT_MORTAR_CRITERIA.version },
  )

  // 检验记录同样按检验编号去重，反复启动只补一份。
  const knownInspectionNos = new Set(
    listInspections().map((row) => String(row['检验编号'] ?? '')),
  )
  const inspections = [
    ...listInspections(),
    ...legacySeed.inspections.filter(
      (row) => !knownInspectionNos.has(String(row['检验编号'])),
    ),
  ]

  // 批次与检验记录一起提交：中途失败两边都不动。
  saveMany({ [MORTAR_MODULE_KEY]: batches, [MORTAR_INSPECTION_KEY]: inspections })
  setMeta(LEGACY_META_KEY, CURRENT_MORTAR_CRITERIA.version)
}

export function listMortarBatches(): EntryRow[] {
  return sortedByDate(listMortar())
}

export function listMortarInspections(): EntryRow[] {
  return [...listInspections()].sort((a, b) =>
    String(b['检验日期'] ?? '').localeCompare(String(a['检验日期'] ?? '')),
  )
}

/** 待用清单唯一口径；同步注浆页与拌制页统计都调它。 */
export function listUsableMortarBatches(): EntryRow[] {
  return sortedByDate(usableMortarBatches(listMortar()))
}

export function mortarCounts() {
  const rows = listMortar()
  return {
    total: rows.length,
    waiting: rows.filter((row) => String(row.status) === MORTAR_STATUS.idle).length,
    mixing: rows.filter((row) => String(row.status) === MORTAR_STATUS.mixing).length,
    usable: usableMortarBatches(rows).length,
    discarded: rows.filter((row) => String(row.status) === MORTAR_STATUS.discarded).length,
  }
}

/** 登记批次：批次编号重复直接返回既有记录，反复提交只入一条；校验不过不写盘。 */
export function registerMortarBatch(
  input: MortarBatchInput,
  operator: string,
): MortarActionResult {
  const batchNo = input.batchNo.trim()
  const mortarType = input.mortarType.trim()
  const mixedOn = input.mixedOn.trim() || today()
  const waterCementRatio = input.waterCementRatio.trim()
  const consistency = input.consistency.trim()

  if (!batchNo) {
    return { ok: false, message: '批次编号不能为空' }
  }
  if (!mortarType) {
    return { ok: false, message: '浆液类型不能为空' }
  }
  if (waterCementRatio && parseMeasure(waterCementRatio) === null) {
    return { ok: false, message: '水灰比需填写数值' }
  }
  if (consistency && parseMeasure(consistency) === null) {
    return { ok: false, message: '稠度需填写数值' }
  }

  const batches = listMortar()
  const existing = batches.find((row) => String(row['批次编号']) === batchNo)
  if (existing) {
    return { ok: true, duplicated: true, row: existing, message: `批次 ${batchNo} 已登记，未重复入库` }
  }

  const row: EntryRow = {
    id: nextId(batches),
    status: MORTAR_STATUS.idle,
    pending: true,
    abnormal: false,
    批次编号: batchNo,
    浆液类型: mortarType,
    水泥用量: input.cementAmount.trim(),
    膨润土用量: input.bentoniteAmount.trim(),
    水灰比: waterCementRatio,
    稠度: consistency,
    拌制日期: mixedOn,
    批次状态: MORTAR_STATUS.idle,
    mortarCriteriaVersion: CURRENT_MORTAR_CRITERIA.version,
    registeredBy: operator,
  }
  saveMany({ [MORTAR_MODULE_KEY]: [...batches, row] })
  return { ok: true, row, message: `批次 ${batchNo} 已登记` }
}

/** 开始拌制：自检数据必须齐全，拌制中仍不是合格，只是进入可送检状态。 */
export function startMixing(batchId: number): MortarActionResult {
  const batches = listMortar()
  const row = findBatch(batches, batchId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的浆液批次` }
  }
  if (String(row.status) === MORTAR_STATUS.discarded) {
    return { ok: false, message: '批次已废弃，不能再拌制' }
  }
  if (readFrozenSnapshot(row)) {
    return { ok: false, message: '批次已完成检验，不能重复拌制' }
  }
  if (String(row.status) === MORTAR_STATUS.mixing) {
    return { ok: true, row, duplicated: true, message: '批次已在拌制中' }
  }
  const evaluation = evaluateMortar(
    { waterCementRatio: row['水灰比'], consistency: row['稠度'] },
    CURRENT_MORTAR_CRITERIA,
  )
  if (!evaluation.complete) {
    return { ok: false, message: '水灰比与稠度自检数据不齐全，不能开始拌制' }
  }
  const updated: EntryRow = {
    ...row,
    status: MORTAR_STATUS.mixing,
    批次状态: MORTAR_STATUS.mixing,
    pending: true,
    mortarCriteriaVersion: CURRENT_MORTAR_CRITERIA.version,
  }
  saveMany({
    [MORTAR_MODULE_KEY]: batches.map((item) => (item === row ? updated : item)),
  })
  return { ok: true, row: updated, message: '批次已开始拌制，待检验入口复测' }
}

/**
 * 检验入口提交复测：检验复测说了算。
 * 同一批次只接受一次——重复提交返回既有冻结结论，不再入第二条检验记录。
 */
export function submitMortarInspection(
  input: MortarInspectionInput,
  operator: string,
): MortarActionResult {
  const batches = listMortar()
  const row = findBatch(batches, input.batchId)
  if (!row) {
    return { ok: false, message: '所选浆液批次不存在' }
  }
  if (String(row.status) === MORTAR_STATUS.discarded) {
    return { ok: false, message: '批次已废弃，不能再送检' }
  }

  const inspections = listInspections()
  const previous = inspections.find(
    (item) => String(item['批次编号']) === String(row['批次编号']),
  )
  if (previous) {
    return {
      ok: true,
      duplicated: true,
      row,
      message: `批次 ${row['批次编号']} 的检验结论已冻结为「${previous['检验结论']}」，重复提交未重复入库`,
    }
  }

  const measures = {
    waterCementRatio: input.waterCementRatio.trim(),
    consistency: input.consistency.trim(),
  }
  if (parseMeasure(measures.waterCementRatio) === null) {
    return { ok: false, message: '复测水灰比需填写数值' }
  }
  if (parseMeasure(measures.consistency) === null) {
    return { ok: false, message: '复测稠度需填写数值' }
  }

  // 用现行判据当场复算，结论与依据随批次一起冻结；以后判据怎么改都不翻案。
  const evaluation = evaluateMortar(measures, CURRENT_MORTAR_CRITERIA)
  const code = evaluation.passed ? 'qualified' : 'rejected'
  const status = evaluation.passed ? MORTAR_STATUS.qualified : MORTAR_STATUS.rejected
  const inspectedOn = input.inspectedOn.trim() || today()
  const dayCount = inspections.filter((item) => String(item['检验日期']) === inspectedOn).length + 1
  const inspectionNo = `INS-${inspectedOn.split('-').join('')}-${String(dayCount).padStart(2, '0')}`
  const inspector = input.inspector.trim() || operator

  const updated = writeFrozenSnapshot(
    {
      ...row,
      status,
      批次状态: status,
      pending: false,
      abnormal: !evaluation.passed,
      inspectedBy: inspector,
    },
    {
      code,
      criteriaVersion: CURRENT_MORTAR_CRITERIA.version,
      basis: `检验复测：${evaluation.summary}`,
      checks: evaluation.checks,
      measured: {
        waterCementRatio: parseMeasure(measures.waterCementRatio),
        consistency: parseMeasure(measures.consistency),
      },
      inspectionNo,
      inspectedOn,
      inspector,
    },
  )

  const inspection: EntryRow = {
    id: nextId(inspections),
    status,
    pending: false,
    abnormal: !evaluation.passed,
    检验编号: inspectionNo,
    批次编号: row['批次编号'],
    检验日期: inspectedOn,
    复测水灰比: measures.waterCementRatio,
    复测稠度: measures.consistency,
    检验结论: status,
    判定依据: `检验复测：${evaluation.summary}`,
    判定判据: CURRENT_MORTAR_CRITERIA.version,
    检验人员: inspector,
  }

  // 批次冻结与检验登记同一事务，任一边失败两边都不落。
  saveMany({
    [MORTAR_MODULE_KEY]: batches.map((item) => (item === row ? updated : item)),
    [MORTAR_INSPECTION_KEY]: [...inspections, inspection],
  })
  return {
    ok: true,
    row: updated,
    message: evaluation.passed
      ? `复测双项合格，批次 ${row['批次编号']} 已进入待用清单`
      : `复测不合格：${evaluation.summary}，批次已冻结为检验不合格`,
  }
}

/**
 * 废弃批次：唯一高风险动作。只认拌制站负责人，越权当场拦下；
 * 已经冻结合格的批次也可以废弃（质量否决），但同样只有负责人能操作。
 */
export function discardMortarBatch(
  batchId: number,
  operator: string,
  role: string,
): MortarActionResult {
  if (role !== MORTAR_DISCARD_ROLE) {
    return { ok: false, message: `只有${MORTAR_DISCARD_ROLE}能废弃批次，当前身份「${role}」无权操作，已拦截` }
  }
  const batches = listMortar()
  const row = findBatch(batches, batchId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的浆液批次` }
  }
  if (String(row.status) === MORTAR_STATUS.discarded) {
    return { ok: true, row, duplicated: true, message: '批次已是废弃状态' }
  }
  const updated: EntryRow = {
    ...row,
    status: MORTAR_STATUS.discarded,
    批次状态: MORTAR_STATUS.discarded,
    pending: false,
    abnormal: true,
    discardedBy: operator,
    discardedAt: today(),
  }
  saveMany({
    [MORTAR_MODULE_KEY]: batches.map((item) => (item === row ? updated : item)),
  })
  return { ok: true, row: updated, message: `批次 ${row['批次编号']} 已废弃，已从待用清单移除` }
}

export type MortarLedger = { filename: string; content: string }

/** 导出台账：判定结论直接取统一算法，不再自己另算一套“要不要废弃/合格”。 */
export function exportMortarLedger(): MortarLedger {
  const lines = [MORTAR_LEDGER_COLUMNS.join(',')]
  for (const row of sortedByDate(listMortar())) {
    const detail = mortarDetailRow(row)
    lines.push(
      MORTAR_LEDGER_COLUMNS.map((column) => String(detail[column] ?? '')).join(','),
    )
  }
  return {
    filename: '浆液拌制台账.csv',
    content: `﻿${lines.join('\n')}`,
  }
}

/** 检验入口明细：与台账、页面同一份拼装结果，不另起炉灶。 */
export function mortarInspectionDetails() {
  return listMortarInspections().map((row) => inspectionDetailRow(row))
}

export { MORTAR_INSPECTION_COLUMNS, MORTAR_LEDGER_COLUMNS }
