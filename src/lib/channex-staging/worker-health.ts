/** No reservation content or exception text belongs in worker health. */
export type WorkerHealth = {
 last_attempt: string; last_success: string | null; last_failure: string | null;
 consecutive_failures: number; outcome: 'success' | 'failure';
};
export function workerHealthStatus(value: WorkerHealth | null, now = Date.now()) {
 if (!value) return 'waiting';
 const age = now - Date.parse(value.last_attempt);
 if (!Number.isFinite(age) || age < -60000) return 'unknown';
 if (age > 5 * 60000) return 'stale';
 return value.outcome === 'failure' ? 'failing' : 'healthy';
}
/** Telemetry failure must never turn a completed booking sync into a failed sync. */
export async function reportWorkerHealth(write: (success: boolean) => Promise<void>, success: boolean) {
 try { await write(success); return true; } catch { return false; }
}
