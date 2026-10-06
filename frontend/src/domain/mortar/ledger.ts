import type { EntryRow } from '@/data/types'

import {
  CURRENT_MORTAR_CRITERIA,
  evaluateMortar,
  parseMeasure,
} from './criteria'
import { MORTAR_STATUS, type MortarDetailRow, type MortarVerdict } from './types'

/** 导出台账与各处明细共用的列：只在这里排一次，避免两处各算一遍。 */
export const MORTAR_LEDGER_COLUMNS = [
  '批次编号',
  '浆液类型',
  '水泥用量',
  '膨润土用量',
  '拌制日期',
  '拌制水灰比',
  '拌制稠度',
  '复测水灰比',
  '复测稠度',
  '判定结论',
  '判定依据',
  '判定判据',
  '当前状态',
] as const

export const MORTAR_INSPECTION_COLUMNS = [
  '检验编号',
  '批次编号',
  '检验日期',
  '复测水灰比',
  '复测稠度',
  '检验结论',
  '判定依据',
  '检验人员',
] as const

type FrozenSnapshot = {
  code: 'qualified' | 'rejected'
  criteriaVersion: string
  basis: string
  checks: MortarVerdict['checks']
  measured: MortarVerdict['measured']
  inspectionNo: string
  inspectedOn: string
  inspector: string
}

/** 检验入口冻结下来的结论快照。冻结后判据怎么改都只看这一份。 */
export function readFrozenSnapshot(row: EntryRow): FrozenSnapshot | null {
  if (!row.mortarVerdict) {
    return null
  }
  try {
    return JSON.parse(String(row.mortarVerdict)) as FrozenSnapshot
  } catch {
    return null
  }
}

export function writeFrozenSnapshot(row: EntryRow, snapshot: FrozenSnapshot): EntryRow {
  return { ...row, mortarVerdict: JSON.stringify(snapshot) }
}

/**
 * 算一条批次的推进结论——全平台唯一口径。
 * - 已废弃：不可投用；
 * - 已冻结（检验合格/检验不合格）：按冻结时的判据与复测值展示，判据变更不翻案；
 * - 其余（待拌制/拌制中）：按现行判据实时复算，结论只能是“待检验”，绝不提前算合格；
 *   拌制自检单独给 selfChecks，仅用于拌制页过程提示。
 */
export function resolveMortarVerdict(row: EntryRow): MortarVerdict {
  const status = String(row.status)
  const selfMeasures = {
    waterCementRatio: parseMeasure(row['水灰比']),
    consistency: parseMeasure(row['稠度']),
  }

  if (status === MORTAR_STATUS.discarded) {
    const snapshot = readFrozenSnapshot(row)
    const live = evaluateMortar(selfMeasures, CURRENT_MORTAR_CRITERIA)
    return {
      code: 'discarded',
      label: '已废弃',
      usable: false,
      frozen: Boolean(snapshot),
      criteriaVersion:
        snapshot?.criteriaVersion ??
        String(row.mortarCriteriaVersion ?? CURRENT_MORTAR_CRITERIA.version),
      basis: '批次已由拌制站负责人废弃',
      checks: snapshot?.checks ?? [],
      selfChecks: live.checks,
      measured: snapshot?.measured ?? selfMeasures,
    }
  }

  const snapshot = readFrozenSnapshot(row)
  if (snapshot) {
    return {
      code: snapshot.code,
      label: snapshot.code === 'qualified' ? '合格（已冻结）' : '不合格（已冻结）',
      usable: snapshot.code === 'qualified',
      frozen: true,
      criteriaVersion: snapshot.criteriaVersion,
      basis: snapshot.basis,
      checks: snapshot.checks,
      selfChecks: evaluateMortar(selfMeasures, CURRENT_MORTAR_CRITERIA).checks,
      measured: snapshot.measured,
    }
  }

  // 未冻结：按现行判据实时复算，但无论自检是否达标都不算合格，检验复测说了算。
  const version = String(row.mortarCriteriaVersion ?? CURRENT_MORTAR_CRITERIA.version)
  const live = evaluateMortar(selfMeasures, CURRENT_MORTAR_CRITERIA)
  return {
    code: 'pending',
    label: '待检验',
    usable: false,
    frozen: false,
    criteriaVersion: version,
    basis: live.complete
      ? `自检${live.passed ? '双项在区间内，仍待检验复测确认' : '存在超项，待检验复测'}`
      : '尚未取得完整自检数据',
    checks: [],
    selfChecks: live.checks,
    measured: selfMeasures,
  }
}

export function isUsableMortar(row: EntryRow): boolean {
  return resolveMortarVerdict(row).usable
}

/** 待用清单：唯一口径，拌制页统计与同步注浆页都调它，看到的个数必然相同。 */
export function usableMortarBatches(rows: EntryRow[]): EntryRow[] {
  return rows.filter(isUsableMortar)
}

function measureText(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * 台账明细的唯一拼装处：页面、检验入口、导出都拿这份扁平列，
 * 不会再出现页面写一套判定、导出又写一套。
 */
export function mortarDetailRow(row: EntryRow): MortarDetailRow {
  const verdict = resolveMortarVerdict(row)
  const self = {
    waterCementRatio: parseMeasure(row['水灰比']),
    consistency: parseMeasure(row['稠度']),
  }
  return {
    批次编号: String(row['批次编号'] ?? ''),
    浆液类型: String(row['浆液类型'] ?? ''),
    水泥用量: String(row['水泥用量'] ?? ''),
    膨润土用量: String(row['膨润土用量'] ?? ''),
    拌制日期: String(row['拌制日期'] ?? ''),
    拌制水灰比: measureText(self.waterCementRatio),
    拌制稠度: measureText(self.consistency),
    复测水灰比: verdict.frozen ? measureText(verdict.measured.waterCementRatio) : '',
    复测稠度: verdict.frozen ? measureText(verdict.measured.consistency) : '',
    判定结论: verdict.label,
    判定依据: verdict.basis,
    判定判据: verdict.criteriaVersion,
    当前状态: String(row.status ?? ''),
  }
}

export function inspectionDetailRow(inspection: EntryRow): MortarDetailRow {
  return {
    检验编号: String(inspection['检验编号'] ?? ''),
    批次编号: String(inspection['批次编号'] ?? ''),
    检验日期: String(inspection['检验日期'] ?? ''),
    复测水灰比: String(inspection['复测水灰比'] ?? ''),
    复测稠度: String(inspection['复测稠度'] ?? ''),
    检验结论: String(inspection['检验结论'] ?? ''),
    判定依据: String(inspection['判定依据'] ?? ''),
    检验人员: String(inspection['检验人员'] ?? ''),
  }
}
