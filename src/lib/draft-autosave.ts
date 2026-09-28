export type DraftSaveResult = { ok: true; savedAt: string } | { ok: false; reason?: string };
export type DraftSaveState = {
  status: 'pending' | 'saving' | 'saved' | 'error';
  savedAt?: string;
};

/** One form's autosave queue. A response acknowledges only the edits captured
 * in that request. Newer edits stay pending, and writes never overlap. */
export function createDraftAutosave<T>({ capture, save, onState, delay = 1500 }: {
  capture: () => T;
  save: (snapshot: T) => Promise<DraftSaveResult>;
  onState: (state: DraftSaveState) => void;
  delay?: number;
}) {
  let revision = 0;
  let savedRevision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let queuedFlush = false;
  let paused = false;
  let disposed = false;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }

  function flush(): Promise<void> {
    clearTimer();
    if (disposed || paused) return Promise.resolve();
    if (inFlight) {
      queuedFlush = true;
      return inFlight;
    }
    if (revision === savedRevision) return Promise.resolve();

    const savingRevision = revision;
    onState({ status: 'saving' });
    inFlight = (async () => {
      let result: DraftSaveResult;
      try { result = await save(capture()); }
      catch { result = { ok: false }; }
      if (disposed) return;
      if (result.ok) savedRevision = savingRevision;
      if (paused) return;

      if (revision !== savingRevision) {
        onState({ status: 'pending' });
      } else if (result.ok) {
        onState({ status: 'saved', savedAt: result.savedAt });
      } else {
        onState({ status: 'error' });
      }
    })().finally(() => {
      inFlight = null;
      if (queuedFlush) {
        queuedFlush = false;
        // A tab-hide flush or elapsed debounce must not wait on another
        // background timer once the older request finishes.
        if (!disposed && !paused && revision !== savedRevision) void flush();
      }
    });
    return inFlight;
  }

  return {
    changed() {
      if (disposed) return;
      revision++;
      onState({ status: 'pending' });
      if (!paused) schedule();
    },
    flush,
    /** Final submission takes over. Let its caller wait for any older write. */
    pause() {
      paused = true;
      clearTimer();
      queuedFlush = false;
      return inFlight;
    },
    resume() {
      if (disposed) return;
      paused = false;
      if (revision !== savedRevision) schedule();
    },
    dispose() {
      disposed = true;
      clearTimer();
      queuedFlush = false;
    },
  };
}
