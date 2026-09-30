/** Serializes writes and only acknowledges the exact revision that was saved. */
export type PendingSave<T> = { value: T; revision: number; status: 'pending' | 'saving' | 'failed' };
export class SaveQueue<T, R = void> {
  private entries = new Map<string, PendingSave<T>>();
  private revision = 0;
  private running: Promise<void> | null = null;
  private disposed = false;
  private save: (value: T) => Promise<R>;
  private changed: (entries: Map<string, PendingSave<T>>) => void;
  private saved?: (result: R) => void;
  constructor(
    save: (value: T) => Promise<R>,
    changed: (entries: Map<string, PendingSave<T>>) => void,
    saved?: (result: R) => void,
  ) { this.save = save; this.changed = changed; this.saved = saved; }
  snapshot() { return new Map(this.entries); }
  enqueue(key: string, value: T, immediately = true) {
    this.entries.set(key, { value, revision: ++this.revision, status: 'pending' });
    this.emit();
    if (immediately) void this.flush();
  }
  restore(key: string, value: T) {
    this.entries.set(key, { value, revision: ++this.revision, status: 'failed' });
    this.emit();
  }
  private emit() { if (!this.disposed) this.changed(this.snapshot()); }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
      // A new edit may arrive after drain finishes but before this microtask.
      if (!this.disposed && [...this.entries.values()].some((entry) => entry.status === 'pending')) void this.flush();
    });
    return this.running;
  }
  retry() {
    for (const [key, entry] of this.entries) {
      if (entry.status === 'failed') this.entries.set(key, { ...entry, status: 'pending' });
    }
    this.emit();
    return this.flush();
  }
  dispose() { this.disposed = true; }
  private async drain() {
    while (!this.disposed) {
      const next = [...this.entries].find(([, entry]) => entry.status === 'pending');
      if (!next) return;
      const [key, entry] = next;
      this.entries.set(key, { ...entry, status: 'saving' });
      this.emit();
      try {
        const result = await this.save(entry.value);
        if (this.entries.get(key)?.revision === entry.revision) {
          this.entries.delete(key);
          if (!this.disposed) this.saved?.(result);
        }
      } catch {
        if (this.entries.get(key)?.revision === entry.revision) {
          this.entries.set(key, { ...entry, status: 'failed' });
        }
      }
      this.emit();
    }
  }
}
