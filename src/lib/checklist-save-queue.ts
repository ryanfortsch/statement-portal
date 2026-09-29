type Edit = { write: () => Promise<void>; ready: boolean; failed: boolean; timer?: ReturnType<typeof setTimeout> };
export type ChecklistSaveStatus = { dirty: boolean; saving: boolean; failures: number; lastSaved: string | null };

/** One writer for the entire checklist, since all its fields share one JSON record. */
export class ChecklistSaveQueue {
  private edits = new Map<string, Edit>();
  private running = false;
  private listeners = new Set<() => void>();
  private waiters: Array<() => void> = [];
  private status: ChecklistSaveStatus = { dirty: false, saving: false, failures: 0, lastSaved: null };

  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish() {
    this.status = { ...this.status, dirty: this.running || this.edits.size > 0, saving: this.running,
      failures: [...this.edits.values()].filter(edit => edit.failed).length };
    this.listeners.forEach(listener => listener());
  }

  enqueue(key: string, write: () => Promise<void>, delay = 0) {
    clearTimeout(this.edits.get(key)?.timer);
    const edit: Edit = { write, ready: delay === 0, failed: false };
    this.edits.set(key, edit);
    if (delay > 0) edit.timer = setTimeout(() => { edit.ready = true; void this.drain(); }, delay);
    this.publish();
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    let next: [string, Edit] | undefined;
    while ((next = [...this.edits].find(([, edit]) => edit.ready && !edit.failed))) {
      const [key, edit] = next;
      this.publish();
      try {
        await edit.write();
        // A reply for an older draft cannot clear its newer replacement.
        if (this.edits.get(key) === edit) this.edits.delete(key);
        this.status = { ...this.status, lastSaved: new Date().toISOString() };
      } catch {
        // Keep the desired value on screen. Retry is explicit, never a loop.
        if (this.edits.get(key) === edit) edit.failed = true;
      }
    }
    this.running = false;
    this.publish();
    this.waiters.splice(0).forEach(resolve => resolve());
  }

  /** Flush debounced edits and wait for every active write; failed edits stay blocked. */
  async flush(): Promise<boolean> {
    for (const edit of this.edits.values()) { clearTimeout(edit.timer); edit.ready = true; }
    void this.drain();
    if (this.running) await new Promise<void>(resolve => this.waiters.push(resolve));
    return !this.status.dirty;
  }

  retry = async () => {
    for (const edit of this.edits.values()) edit.failed = false;
    return this.flush();
  };

  cancelQueued = () => {
    for (const edit of this.edits.values()) clearTimeout(edit.timer);
    this.edits.clear();
    this.publish();
  };
}
