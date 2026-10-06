import type { MortarCheckItem, MortarMeasures } from './types'

/**
 * 浆液推进判据：全平台只此一份。页面自检、检验入口复测、导出台账都走这里，
 * 改限值不需要再找三处。判据带版本号，已冻结的结论记录当时版本，不被新判据翻案。
 */
export type MortarCriteria = {
  version: string
  /** 本版判据生效日期，用于给历史批次补登结论时选用当时的判据。 */
  effectiveFrom: string
  note: string
  waterCementRatio: { min: number; max: number; label: string; unit: string }
  consistency: { min: number; max: number; label: string; unit: string }
}

// 历史判据：早先水灰比放宽到 0.80，稠度上限 110。
export const MORTAR_CRITERIA_V1: MortarCriteria = {
  version: 'V1',
  effectiveFrom: '2026-01-01',
  note: '水灰比 0.45–0.80，稠度 80–110mm',
  waterCementRatio: { min: 0.45, max: 0.8, label: '水灰比', unit: '' },
  consistency: { min: 80, max: 110, label: '稠度', unit: 'mm' },
}

// 现行判据：水灰比收紧到 0.70，稠度上限 100。
export const MORTAR_CRITERIA_V2: MortarCriteria = {
  version: 'V2',
  effectiveFrom: '2026-09-20',
  note: '水灰比 0.45–0.70，稠度 80–100mm',
  waterCementRatio: { min: 0.45, max: 0.7, label: '水灰比', unit: '' },
  consistency: { min: 80, max: 100, label: '稠度', unit: 'mm' },
}

/** 判据时间线，按生效日期升序。给老批次补登时按拌制日期挑当时有效的版本。 */
export const MORTAR_CRITERIA_TIMELINE: MortarCriteria[] = [
  MORTAR_CRITERIA_V1,
  MORTAR_CRITERIA_V2,
]

export const CURRENT_MORTAR_CRITERIA = MORTAR_CRITERIA_V2

/** 拌制日期落在哪个判据版本的生效区间，就用哪版复算（补登历史批次时用）。 */
export function criteriaEffectiveOn(date: string): MortarCriteria {
  let picked = MORTAR_CRITERIA_TIMELINE[0]
  for (const criteria of MORTAR_CRITERIA_TIMELINE) {
    if (date >= criteria.effectiveFrom) {
      picked = criteria
    }
  }
  return picked
}

export function parseMeasure(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  const text = String(raw ?? '').trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function checkRange(
  measures: MortarMeasures,
  field: 'waterCementRatio' | 'consistency',
  range: { min: number; max: number; label: string; unit: string },
): MortarCheckItem {
  const value = parseMeasure(measures[field])
  if (value === null) {
    return {
      field,
      label: range.label,
      value: null,
      min: range.min,
      max: range.max,
      unit: range.unit,
      passed: false,
      detail: `${range.label}未取得有效读数`,
    }
  }
  const passed = value >= range.min && value <= range.max
  return {
    field,
    label: range.label,
    value,
    min: range.min,
    max: range.max,
    unit: range.unit,
    passed,
    detail: passed
      ? `${range.label} ${value}${range.unit} 在 ${range.min}–${range.max}${range.unit} 内`
      : `${range.label} ${value}${range.unit} 超出 ${range.min}–${range.max}${range.unit}`,
  }
}

export type MortarEvaluation = {
  passed: boolean
  complete: boolean
  checks: MortarCheckItem[]
  summary: string
}

/**
 * 唯一的合格性判定：水灰比与稠度双项都在判据区间内才算合格；
 * 读数缺失或缺项即未取得完整检测，不得判合格（不会再出现“拌制中导出成合格”）。
 */
export function evaluateMortar(
  measures: MortarMeasures,
  criteria: MortarCriteria = CURRENT_MORTAR_CRITERIA,
): MortarEvaluation {
  const checks = [
    checkRange(measures, 'waterCementRatio', criteria.waterCementRatio),
    checkRange(measures, 'consistency', criteria.consistency),
  ]
  const complete = checks.every((item) => item.value !== null)
  const passed = complete && checks.every((item) => item.passed)
  const summary = !complete
    ? '检测数据不完整'
    : passed
      ? `双项合格（${criteria.note}）`
      : checks
          .filter((item) => !item.passed)
          .map((item) => item.detail)
          .join('；')
  return { passed, complete, checks, summary }
}
