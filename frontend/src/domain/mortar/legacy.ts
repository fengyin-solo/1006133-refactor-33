import type { EntryRow } from '@/data/types'

import { criteriaEffectiveOn, evaluateMortar } from './criteria'
import { writeFrozenSnapshot } from './ledger'
import { MORTAR_STATUS } from './types'

/**
 * 老批次数据：按拌制日期补登。已送检的批次用拌制日期当时有效的判据复算并冻结结论，
 * 判据再收紧也不改老结论；未送检的批次只留拌制自检值，结论仍待检验。
 */
type LegacyBatchSpec = {
  no: string
  mortarType: string
  date: string
  waterCementRatio: number
  consistency: number
  cement: string
  bentonite: string
  outcome: 'qualified' | 'rejected' | 'mixing' | 'idle' | 'discarded'
  inspector: string
}

const LEGACY_BATCHES: LegacyBatchSpec[] = [
  // —— V1 判据期（2026-09-20 前）：水灰比上限 0.80、稠度上限 110 ——
  { no: 'MORT-20260902-01', mortarType: '同步注浆砂浆', date: '2026-09-02', waterCementRatio: 0.62, consistency: 96, cement: '180kg/m³', bentonite: '30kg/m³', outcome: 'qualified', inspector: '王检' },
  { no: 'MORT-20260905-01', mortarType: '同步注浆砂浆', date: '2026-09-05', waterCementRatio: 0.74, consistency: 98, cement: '175kg/m³', bentonite: '32kg/m³', outcome: 'qualified', inspector: '王检' },
  { no: 'MORT-20260910-01', mortarType: '同步注浆砂浆', date: '2026-09-10', waterCementRatio: 0.82, consistency: 95, cement: '190kg/m³', bentonite: '28kg/m³', outcome: 'rejected', inspector: '李检' },
  { no: 'MORT-20260912-01', mortarType: '同步注浆砂浆', date: '2026-09-12', waterCementRatio: 0.6, consistency: 112, cement: '180kg/m³', bentonite: '30kg/m³', outcome: 'rejected', inspector: '李检' },
  { no: 'MORT-20260915-01', mortarType: '同步注浆砂浆', date: '2026-09-15', waterCementRatio: 0.85, consistency: 90, cement: '195kg/m³', bentonite: '26kg/m³', outcome: 'discarded', inspector: '李检' },
  { no: 'MORT-20260918-01', mortarType: '同步注浆砂浆', date: '2026-09-18', waterCementRatio: 0.58, consistency: 92, cement: '170kg/m³', bentonite: '34kg/m³', outcome: 'qualified', inspector: '王检' },
  { no: 'MORT-20260919-01', mortarType: '同步注浆砂浆', date: '2026-09-19', waterCementRatio: 0.66, consistency: 104, cement: '178kg/m³', bentonite: '31kg/m³', outcome: 'qualified', inspector: '王检' },
  // —— V2 现行判据期（2026-09-20 起）：水灰比上限 0.70、稠度上限 100 ——
  { no: 'MORT-20260922-01', mortarType: '同步注浆砂浆', date: '2026-09-22', waterCementRatio: 0.66, consistency: 95, cement: '176kg/m³', bentonite: '31kg/m³', outcome: 'qualified', inspector: '王检' },
  { no: 'MORT-20260924-01', mortarType: '同步注浆砂浆', date: '2026-09-24', waterCementRatio: 0.72, consistency: 94, cement: '182kg/m³', bentonite: '30kg/m³', outcome: 'rejected', inspector: '李检' },
  { no: 'MORT-20260926-01', mortarType: '同步注浆砂浆', date: '2026-09-26', waterCementRatio: 0.61, consistency: 99, cement: '172kg/m³', bentonite: '33kg/m³', outcome: 'qualified', inspector: '王检' },
  // —— 近期在制/待拌制：还没有复测，结论待检验 ——
  { no: 'MORT-20261002-01', mortarType: '同步注浆砂浆', date: '2026-10-02', waterCementRatio: 0.63, consistency: 97, cement: '174kg/m³', bentonite: '32kg/m³', outcome: 'mixing', inspector: '' },
  { no: 'MORT-20261003-01', mortarType: '同步注浆砂浆', date: '2026-10-03', waterCementRatio: 0.73, consistency: 90, cement: '184kg/m³', bentonite: '29kg/m³', outcome: 'mixing', inspector: '' },
  { no: 'MORT-20261004-01', mortarType: '同步注浆砂浆', date: '2026-10-04', waterCementRatio: 0.55, consistency: 102, cement: '170kg/m³', bentonite: '34kg/m³', outcome: 'mixing', inspector: '' },
  { no: 'MORT-20261005-01', mortarType: '同步注浆砂浆', date: '2026-10-05', waterCementRatio: 0, consistency: 0, cement: '—', bentonite: '—', outcome: 'idle', inspector: '' },
]

function baseRow(id: number, spec: LegacyBatchSpec, status: string): EntryRow {
  return {
    id,
    status,
    pending: status === MORTAR_STATUS.idle || status === MORTAR_STATUS.mixing,
    abnormal: false,
    批次编号: spec.no,
    浆液类型: spec.mortarType,
    水泥用量: spec.cement,
    膨润土用量: spec.bentonite,
    水灰比: spec.outcome === 'idle' ? '' : String(spec.waterCementRatio),
    稠度: spec.outcome === 'idle' ? '' : String(spec.consistency),
    拌制日期: spec.date,
    批次状态: status,
    mortarCriteriaVersion: criteriaEffectiveOn(spec.date).version,
  }
}

export type LegacyMortarData = {
  batches: EntryRow[]
  inspections: EntryRow[]
}

/** 生成补登用的老批次与对应检验记录：冻结结论全部走统一算法，不手抄。 */
export function buildLegacyMortarData(): LegacyMortarData {
  const batches: EntryRow[] = []
  const inspections: EntryRow[] = []
  let inspectionId = 1

  LEGACY_BATCHES.forEach((spec, index) => {
    const criteria = criteriaEffectiveOn(spec.date)
    let status: string = MORTAR_STATUS.mixing
    if (spec.outcome === 'idle') {
      status = MORTAR_STATUS.idle
    } else if (spec.outcome === 'qualified') {
      status = MORTAR_STATUS.qualified
    } else if (spec.outcome === 'rejected' || spec.outcome === 'discarded') {
      status = MORTAR_STATUS.rejected
    }

    let row = baseRow(index + 1, spec, status)

    if (spec.outcome !== 'idle' && spec.outcome !== 'mixing') {
      const evaluation = evaluateMortar(
        { waterCementRatio: spec.waterCementRatio, consistency: spec.consistency },
        criteria,
      )
      const code = evaluation.passed ? 'qualified' : 'rejected'
      const inspectionNo = `INS-${spec.date.split('-').join('')}-01`
      row = writeFrozenSnapshot(row, {
        code,
        criteriaVersion: criteria.version,
        basis: `检验复测：${evaluation.summary}`,
        checks: evaluation.checks,
        measured: { waterCementRatio: spec.waterCementRatio, consistency: spec.consistency },
        inspectionNo,
        inspectedOn: spec.date,
        inspector: spec.inspector,
      })
      if (spec.outcome === 'discarded') {
        row = { ...row, status: MORTAR_STATUS.discarded, 批次状态: MORTAR_STATUS.discarded, pending: false, discardedBy: '拌制站负责人' }
      }
      inspections.push({
        id: inspectionId++,
        status: code === 'qualified' ? MORTAR_STATUS.qualified : MORTAR_STATUS.rejected,
        pending: false,
        abnormal: code !== 'qualified',
        检验编号: inspectionNo,
        批次编号: spec.no,
        检验日期: spec.date,
        复测水灰比: String(spec.waterCementRatio),
        复测稠度: String(spec.consistency),
        检验结论: code === 'qualified' ? MORTAR_STATUS.qualified : MORTAR_STATUS.rejected,
        判定依据: `检验复测：${evaluation.summary}`,
        判定判据: criteria.version,
        检验人员: spec.inspector,
      })
    }
    batches.push(row)
  })

  return { batches, inspections }
}
