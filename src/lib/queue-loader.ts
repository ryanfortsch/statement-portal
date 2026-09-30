/** A bounded feed read. Only the newest request may replace the visible queue. */
export type QueueLoadStatus = 'ready' | 'refreshing' | 'failed' | 'offline';

export function createQueueLoader<T>(options: {
  read: (signal: AbortSignal) => Promise<T>;
  accept: (data: T) => void;
  status: (status: QueueLoadStatus) => void;
  timeoutMs?: number;
}) {
  let current: { controller: AbortController; promise: Promise<void> } | undefined;
  const cancel = () => {
    const previous = current;
    current = undefined;
    previous?.controller.abort();
  };
  const load = (replace = false): Promise<void> => {
    if (current && !replace) return current.promise;
    cancel();
    const controller = new AbortController();
    const request = { controller, promise: Promise.resolve() };
    current = request;
    options.status('refreshing');
    request.promise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Queue refresh interrupted')), { once: true });
        timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
      });
      try {
        const data = await Promise.race([options.read(controller.signal), aborted]);
        if (current !== request) return;
        options.accept(data);
        options.status('ready');
      } catch {
        if (current === request) options.status('failed');
      } finally {
        clearTimeout(timer);
        if (current === request) current = undefined;
      }
    })();
    return request.promise;
  };
  return { load, cancel };
}

export async function readQueue<T extends { id: string }, C>(url: string, signal: AbortSignal): Promise<{ approvals: T[]; context?: C }> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Queue refresh failed');
  const data = await response.json();
  if (!data || !Array.isArray(data.approvals) || data.approvals.some((item: unknown) =>
    !item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string')) {
    throw new Error('Invalid queue response');
  }
  return data;
}
