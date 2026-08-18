const LEGACY_STORAGE_PREFIXES = [
  ['cutline.', 'editweave.'],
  ['cutline-', 'editweave-'],
] as const

const BRANDED_VALUE_KEYS = new Set(['schema', 'version', 'format'])

export function migrateLegacyBrandValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => migrateLegacyBrandValue(item)) as T
  if (!value || typeof value !== 'object') return value
  const migrated: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    migrated[key] = BRANDED_VALUE_KEYS.has(key) && typeof child === 'string' && child.startsWith('cutline-')
      ? `editweave-${child.slice('cutline-'.length)}`
      : migrateLegacyBrandValue(child)
  }
  return migrated as T
}

export function migrateLegacyBrowserStorage(storage: Storage = localStorage): number {
  const legacyKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key))
  let migratedCount = 0
  for (const legacyKey of legacyKeys) {
    const mapping = LEGACY_STORAGE_PREFIXES.find(([prefix]) => legacyKey.startsWith(prefix))
    if (!mapping || legacyKey.includes('update-attempt')) continue
    const nextKey = `${mapping[1]}${legacyKey.slice(mapping[0].length)}`
    if (storage.getItem(nextKey) !== null) continue
    const raw = storage.getItem(legacyKey)
    if (raw === null) continue
    let migrated = raw
    try {
      migrated = JSON.stringify(migrateLegacyBrandValue(JSON.parse(raw)))
    } catch {
      // Plain string preferences do not need structural migration.
    }
    storage.setItem(nextKey, migrated)
    migratedCount += 1
  }
  return migratedCount
}
