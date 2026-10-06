/** 浆液批次推进领域的公共类型：页面、检验入口、导出都只认这里的结构。 */
import type { EntryRow } from '@/data/types'

export const MORTAR_MODULE_KEY = 'mortar'
export const MORTAR_INSPECTION_KEY = 'mortarInspection'

/** 批次流转状态。 */
export const MORTAR_STATUS = {
  idle: '待拌制',
  mixing: '拌制中',
  qualified: '检验合格',
  rejected: '检验不合格',
  discarded: '已废弃',
} as const

export type MortarStatus = (typeof MORTAR_STATUS)[keyof typeof MORTAR_STATUS]

/** 送进判定算法的两路实测值：拌制自检或检验复测都归一化成这个形状。 */
export type MortarMeasures = {
  waterCementRatio: unknown
  consistency: unknown
}

export type MortarCheckItem = {
  field: 'waterCementRatio' | 'consistency'
  label: string
  value: number | null
  min: number
  max: number
  unit: string
  passed: boolean
  detail: string
}

export type MortarVerdictCode = 'qualified' | 'rejected' | 'pending' | 'discarded'

/** 一条批次的推进结论。frozen 表示结论已被检验入口冻结，只按冻结时的判据版本展示。 */
export type MortarVerdict = {
  code: MortarVerdictCode
  label: string
  usable: boolean
  frozen: boolean
  criteriaVersion: string
  basis: string
  /** 判定所依据的那一路检测项（冻结后为复测项，未冻结时为空）。 */
  checks: MortarCheckItem[]
  /** 拌制自检按现行判据实时复算的结果，只作过程提示。 */
  selfChecks: MortarCheckItem[]
  measured: { waterCementRatio: number | null; consistency: number | null }
}

export type MortarBatchInput = {
  batchNo: string
  mortarType: string
  cementAmount: string
  bentoniteAmount: string
  waterCementRatio: string
  consistency: string
  mixedOn: string
}

export type MortarInspectionInput = {
  batchId: number
  waterCementRatio: string
  consistency: string
  inspectedOn: string
  inspector: string
}

export type MortarActionResult = {
  ok: boolean
  message: string
  /** 命中幂等：提交已存在，未重复入库。 */
  duplicated?: boolean
  row?: EntryRow
}

export type MortarDetailRow = Record<string, string | number | boolean>
