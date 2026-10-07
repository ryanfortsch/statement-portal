type Entry = Record<string, unknown>;
type Listings = Record<string, Entry>;

type RegistryReader = {
  getFile(path: string, ref: string): Promise<{ contentUtf8: string } | null>;
  branchExists(branch: string): Promise<boolean>;
  getMergeBaseSha(base: string, head: string): Promise<string>;
};

const COPY_FIELDS = ['tagline', 'description', 'highlights'] as const;
type CopyField = typeof COPY_FIELDS[number];

function value(entry: Entry, field: CopyField): string {
  if (field === 'highlights') {
    return JSON.stringify(Array.isArray(entry.highlights)
      ? entry.highlights.map(h => String(h ?? '').trim()).filter(Boolean) : []);
  }
  return String(entry[field] ?? '').trim();
}

/** Read pending copy without replacing newer live listing metadata or copy. */
export async function loadListingCopyEntries(
  github: RegistryReader, path: string, productionBranch: string, copyBranch: string,
): Promise<{ id: string; entry: Entry; staged: boolean }[]> {
  async function read(ref: string): Promise<Listings> {
    const file = await github.getFile(path, ref);
    if (!file) throw new Error(`Could not read ${path} at ${ref}. Reload to try again.`);
    const registry = JSON.parse(file.contentUtf8);
    if (!registry?.listings || typeof registry.listings !== 'object' || Array.isArray(registry.listings)) {
      throw new Error(`Invalid listing registry at ${ref}. Reload to try again.`);
    }
    return registry.listings;
  }

  const live = await read(productionBranch);
  let batch: Listings = {};
  let base: Listings = {};
  if (await github.branchExists(copyBranch)) {
    // A failed batch read must not silently show live copy and "Publish all (0)".
    batch = await read(copyBranch);
    base = await read(await github.getMergeBaseSha(productionBranch, copyBranch));
  }

  return Object.entries(live).map(([id, production]) => {
    const entry = { ...production };
    const pending = batch[id];
    const original = base[id];
    if (pending && original) {
      for (const field of COPY_FIELDS) {
        // Only restore fields edited on the batch branch. Other live changes win.
        if (value(pending, field) !== value(original, field)) {
          if (Object.hasOwn(pending, field)) entry[field] = pending[field];
          else delete entry[field];
        }
      }
    }
    return { id, entry, staged: COPY_FIELDS.some(field => value(entry, field) !== value(production, field)) };
  });
}
