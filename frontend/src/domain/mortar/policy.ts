/**
 * 浆液批次推进判据 —— 全站唯一维护点。
 *
 * 拌制页面、检验入口、导出台账、同步注浆待用清单对“这批能不能投用”的回答，
 * 只能来自本文件的 evaluateBatch / isReadyForUse，任何页面不得再各算一遍。
 *
 * 哪一栏说了算（业务裁定）：
 * - 稠度是投用性能的直接量，定为【主判栏】；水灰比是配合比核算栏，作为并行门槛。
 * - 两栏都能读出数值时，必须同时落在判据区间内才算合格，一栏不过即不合格。
 * - 只有一栏能读出数值时（另一栏缺测/无法解析），以稠度为准；水灰比单独存在不能定合格。
 * - 两栏都无法读出数值时，判“数据不全，不允许投用”，不猜测结论。
 */

/** 一个数值区间（闭区间），边界值算合格。 */
export type NumericBand = {
  min: number
  max: number
  unit: string
}

/** 一版推进判据。改判据就是新增/修改这里的版本，全站自动跟着走。 */
export type MortarPolicy = {
  /** 判据版本，以生效日期编号，例如 2026-10-01。 */
  version: string
  /** 生效日期（YYYY-MM-DD），仅作展示与追溯。 */
  effectiveDate: string
  /** 稠度合格区间——主判栏。 */
  consistency: NumericBand
  /** 水灰比合格区间。 */
  waterCementRatio: NumericBand
  note: string
}

export type Verdict = '合格' | '不合格' | '数据不全'

export type FieldCheck = {
  field: string
  raw: string
  value: number | null
  band: NumericBand
  pass: boolean | null // null = 该栏没有可读数值
}

/** 判定结论明细——三个入口展示的都是同一份明细，不再各写措辞。 */
export type Evaluation = {
  verdict: Verdict
  /** 主判栏（稠度）检查结果。 */
  consistencyCheck: FieldCheck
  /** 水灰比检查结果。 */
  ratioCheck: FieldCheck
  /** 人话理由，导出/页面/检验共用这一份。 */
  reason: string
  /** 判定时采用的判据版本。 */
  policyVersion: string
}

/** 合格即“可投用”。历史结论是否仍有效由调用方按快照判断，不由引擎翻案。 */
export function isPassed(evaluation: Evaluation): boolean {
  return evaluation.verdict === '合格'
}

/**
 * 判据集中成一份配置：历史版本保留（老批次追溯用），CURRENT 是当前在用版本。
 * 要改判据：新增一个版本对象，把 CURRENT 指向它；不要悄悄改老版本的数值，
 * 否则早先按当时判据下的结论就对不上了。
 */
export const MORTAR_POLICIES: MortarPolicy[] = [
  {
    version: '2026-06-01',
    effectiveDate: '2026-06-01',
    consistency: { min: 70, max: 130, unit: 'mm' },
    waterCementRatio: { min: 0.45, max: 0.8, unit: '' },
    note: '老配比阶段判据，区间较宽；仅用于追溯当时登记批次的结论。',
  },
  {
    version: '2026-10-01',
    effectiveDate: '2026-10-01',
    consistency: { min: 80, max: 120, unit: 'mm' },
    waterCementRatio: { min: 0.5, max: 0.7, unit: '' },
    note: '现行判据：稠度 80~120mm 且水灰比 0.50~0.70。',
  },
]

export const CURRENT_MORTAR_POLICY: MortarPolicy =
  MORTAR_POLICIES.find((item) => item.version === '2026-10-01') ?? MORTAR_POLICIES[MORTAR_POLICIES.length - 1]

export function getMortarPolicy(version: string): MortarPolicy {
  const found = MORTAR_POLICIES.find((item) => item.version === version)
  return found ?? CURRENT_MORTAR_POLICY
}

/** 把“85mm / 0.62 / 110”这类录入值解析成数字；解析不出返回 null，绝不拿 NaN 去比区间。 */
export function parseMeasure(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw !== 'string') {
    return null
  }
  const matched = raw.trim().match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  const value = Number(matched[0])
  return Number.isFinite(value) ? value : null
}

function checkField(field: string, raw: unknown, band: NumericBand): FieldCheck {
  const value = parseMeasure(raw)
  return {
    field,
    raw: typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw),
    value,
    band,
    pass: value === null ? null : value >= band.min && value <= band.max,
  }
}

/**
 * 唯一判定入口。传入批次的两栏录入值与采用的判据，返回统一结论。
 * 拌制页面的预检、检验入口的提交、导出台账、待用清单全部调这里。
 */
export function evaluateBatch(input: {
  consistency?: unknown
  waterCementRatio?: unknown
  policy?: MortarPolicy
}): Evaluation {
  const policy = input.policy ?? CURRENT_MORTAR_POLICY
  const consistencyCheck = checkField('稠度', input.consistency, policy.consistency)
  const ratioCheck = checkField('水灰比', input.waterCementRatio, policy.waterCementRatio)

  const readable = [consistencyCheck, ratioCheck].filter((item) => item.value !== null)
  let verdict: Verdict
  let reason: string

  if (readable.length === 0) {
    verdict = '数据不全'
    reason = '稠度与水灰比均无有效数值，无法判定，不允许投用'
  } else if (readable.length === 1) {
    // 只有一栏可读：稠度为主判栏，稠度说了算；只有水灰比不能定合格。
    const only = readable[0]
    if (only.field === '稠度') {
      verdict = only.pass ? '合格' : '不合格'
      reason = only.pass
        ? `稠度 ${only.value}${policy.consistency.unit} 落在 ${policy.consistency.min}~${policy.consistency.max}${policy.consistency.unit}（水灰比缺测，以主判栏稠度为准）`
        : `稠度 ${only.value}${policy.consistency.unit} 超出 ${policy.consistency.min}~${policy.consistency.max}${policy.consistency.unit}（以主判栏稠度为准）`
    } else {
      verdict = '数据不全'
      reason = '稠度无有效数值，主判栏缺失；仅凭水灰比不得判定合格'
    }
  } else {
    const failed = [consistencyCheck, ratioCheck].find((item) => item.pass === false)
    verdict = failed ? '不合格' : '合格'
    reason = failed
      ? `${failed.field} ${failed.value}${failed.band.unit} 超出 ${failed.band.min}~${failed.band.max}${failed.band.unit}`
      : `稠度 ${consistencyCheck.value}${policy.consistency.unit}、水灰比 ${ratioCheck.value} 均在判据区间内`
  }

  return { verdict, consistencyCheck, ratioCheck, reason, policyVersion: policy.version }
}

export function describeBand(band: NumericBand): string {
  return `${band.min}~${band.max}${band.unit}`
}
