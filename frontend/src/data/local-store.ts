import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
// 种子结构版本：浆液批次领域改造（新增检验快照/真实判据字段）后升到 2。
// 旧版本缓存里的浆液假数据按新种子「按拌制日期补登」，其余模块的用户数据保留。
const DATA_VERSION = 2
const MORTAR_KEY = 'mortar'
const META_KEY = '__version__'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seeded(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function withVersion(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  return { ...data, [META_KEY]: DATA_VERSION as unknown as EntryRow[] }
}

function migrate(stored: Record<string, unknown>): Record<string, EntryRow[]> {
  const fallback = seeded()
  const migrated: Record<string, EntryRow[]> = { ...fallback }
  for (const key of Object.keys(fallback)) {
    if (key === MORTAR_KEY) {
      // 浆液批次改了模型：老批次一律按拌制日期在新种子里补登，旧缓存丢弃。
      continue
    }
    const candidate = stored[key]
    if (Array.isArray(candidate)) {
      migrated[key] = candidate as EntryRow[]
    }
  }
  return withVersion(migrated)
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = withVersion(seeded())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed[META_KEY] !== DATA_VERSION) {
      const next = migrate(parsed)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    }
    return parsed as unknown as Record<string, EntryRow[]>
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/**
 * 原子落库：先在内存里组装完整新数据并预序列化，任何一步失败都返回 false，
 * 内存缓存与 localStorage 维持原状——“入库失败一律不落”。
 */
export function commitRows(key: string, rows: EntryRow[]): boolean {
  const next = { ...allRows(), [key]: rows }
  let serialized: string
  try {
    serialized = JSON.stringify(next)
  } catch {
    return false
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized)
    } catch {
      return false
    }
  }
  cache = next
  return true
}

/** 通用模块的写入口也走原子提交，避免半落库。 */
export function saveRows(key: string, rows: EntryRow[]): void {
  commitRows(key, rows)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
