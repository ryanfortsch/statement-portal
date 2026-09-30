export function isStaleDeployError(error: Error): boolean {
  return error.name === 'ChunkLoadError' || /loading chunk [\d]+ failed|chunkloaderror|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(error.message);
}

/** If storage is blocked, keep manual recovery available instead of risking a reload loop. */
export function claimDeployReload(storage: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): boolean {
  try {
    const key = 'helm-stale-deploy-reload-at';
    const previous = Number(storage.getItem(key) || 0);
    if (previous && now - previous < 60_000) return false;
    storage.setItem(key, String(now));
    return true;
  } catch {
    return false;
  }
}

export function availableCount(result: { count: number | null; error?: unknown }): number | null {
  return result.error ? null : result.count;
}
