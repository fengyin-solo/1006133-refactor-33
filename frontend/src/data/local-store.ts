import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
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

export function saveRows(key: string, rows: EntryRow[]): void {
  saveMany({ [key]: rows })
}

/**
 * 一次提交多个模块：先在内存里拼出全量再一次性写 localStorage。
 * 任一步抛错都会在写入前发生，旧状态保持不变——入库失败一律不落半成品。
 */
export function saveMany(updates: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...updates }
  const serialized = JSON.stringify(next)
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先序列化后写盘：JSON 出错时根本不会触达 localStorage。
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = next
}

/** 领域层自用的小标记（如补登版本号），混在同一份存储里、刷新不丢。 */
export function getMeta(key: string): string | null {
  const meta = allRows().__meta__
  if (!meta) {
    return null
  }
  const value = meta.find((row) => String(row.mark ?? '') === key)
  return value ? String(value.value ?? '') : null
}

export function setMeta(key: string, value: string): void {
  const meta = allRows().__meta__ ?? []
  const index = meta.findIndex((row) => String(row.mark ?? '') === key)
  const nextMeta = [...meta]
  if (index >= 0) {
    nextMeta[index] = { ...nextMeta[index], value }
  } else {
    nextMeta.push({
      id: meta.length + 1,
      status: '',
      pending: false,
      abnormal: false,
      mark: key,
      value,
    })
  }
  saveMany({ __meta__: nextMeta })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
