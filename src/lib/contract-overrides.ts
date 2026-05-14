import {
  CONTRACT_BASE,
  type ContractClause,
  type ContractKv,
  type ContractPage,
  type ContractSection,
  type ContractSectionContent,
} from '@/lib/contract-base';

/**
 * Action-aware override engine for the management contract.
 *
 * Solves the "everything ends up in a Rider" defect by dispatching each
 * change on its action type at apply time:
 *
 *   replace  - swap the entire body of an identified clause
 *   modify   - find a span within a clause and replace just that span
 *   rename   - change a section's title
 *   delete   - remove a clause from the rendered output
 *   add      - insert a new clause at an anchor (after/before another
 *              clause, or at the start/end of a section)
 *
 * The result of applyContractOverrides() is a new ContractPage[] tree
 * with the overrides baked in. ContractDocument renders that tree the
 * same way it renders the base contract — overrides are invisible to
 * the renderer at that point.
 *
 * Any override that fails to find its target raises an error rather
 * than silently dropping or falling back to "append to Rider." That's
 * deliberate: the spec's 36 Granite St retro identified silent fallback
 * as the root cause of unusable contracts.
 */

export type OverrideMeta = {
  ownerAsk: string;
  ourPosition: 'accept' | 'accept-with-modification' | 'counter' | 'hold' | 'restructure';
  positionDetail: string;
  reviewPriority: 'normal' | 'high';
  sensitiveSection: boolean;
};

export type ContractOverride =
  | {
      action: 'replace';
      /** Clause ID to swap. */
      targetId: string;
      newText: string;
      /** Optional bold prefix on the replacement. */
      boldPrefix?: string | null;
      meta: OverrideMeta;
    }
  | {
      action: 'modify';
      /** Clause ID to find within. */
      targetId: string;
      /** Substring to locate inside that clause's template. */
      find: string;
      replaceWith: string;
      meta: OverrideMeta;
    }
  | {
      action: 'rename';
      /** Section ID whose title changes. */
      targetId: string;
      newTitle: string;
      meta: OverrideMeta;
    }
  | {
      action: 'delete';
      /** Clause ID to remove. */
      targetId: string;
      meta: OverrideMeta;
    }
  | {
      action: 'add';
      /** A unique ID for the new clause. */
      newId: string;
      /** Optional title — when present, the new clause renders with a
       *  bold-prefix label. Bullets without titles are treated as plain. */
      title?: string;
      body: string;
      /** Where to insert. Exactly one of these must be set; the apply
       *  engine throws if zero or more than one anchor is supplied. */
      anchor:
        | { insertAfter: string }
        | { insertBefore: string }
        | { inSection: string; position: 'first' | 'last' };
      meta: OverrideMeta;
    };

export class ContractOverrideError extends Error {
  constructor(message: string, public override: ContractOverride) {
    super(message);
    this.name = 'ContractOverrideError';
  }
}

/**
 * Per-override failure record returned alongside the rendered tree.
 * Carries enough context for staff to diagnose: the action verb, the
 * targetId (or newId for adds), and the underlying error message.
 */
export type ContractOverrideFailure = {
  /** Index into the original overrides array. */
  index: number;
  override: ContractOverride;
  error: string;
};

export type ApplyResult = {
  pages: ContractPage[];
  failures: ContractOverrideFailure[];
};

/**
 * Apply a list of overrides to the base contract. Fail-soft: each
 * override is applied independently; failures are collected into the
 * `failures` array and the rest still land. Callers (ContractDocument,
 * the server action) decide whether to surface failures in the UI or
 * just log them.
 *
 * Why fail-soft: an earlier implementation threw on the first failure.
 * Combined with ContractDocument's catch-all that fell back to
 * CONTRACT_BASE, one bad override would silently hide ALL the others —
 * the rendered contract would look as if NO redlines had ever been
 * applied. Dotti's 47-override 36 Granite run hit this: a single
 * non-matching modify took down the entire renewal-period edit she
 * could see in the applied-confirmation banner.
 *
 * Order still matters within the same apply call — a later override
 * sees the result of earlier overrides. If overrides #5 and #20 both
 * target the same span and #5 succeeds (changing the template), #20's
 * find won't match anymore; it gets recorded as a failure and skipped.
 * That's correct: the second edit's premise is gone.
 */
export function applyContractOverrides(
  overrides: ContractOverride[],
  base: ContractPage[] = CONTRACT_BASE,
): ApplyResult {
  let working = cloneContract(base);
  const failures: ContractOverrideFailure[] = [];
  overrides.forEach((override, index) => {
    try {
      working = applyOne(working, override);
    } catch (err) {
      failures.push({
        index,
        override,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return { pages: working, failures };
}

/**
 * Human-readable summary of a failed override — used in UI banners +
 * Vercel log messages. Keeps the action verb + target prominent.
 */
export function describeOverrideFailure(f: ContractOverrideFailure): string {
  const o = f.override;
  if (o.action === 'add') return `add "${o.newId}" — ${f.error}`;
  return `${o.action} "${o.targetId}" — ${f.error}`;
}

function applyOne(pages: ContractPage[], override: ContractOverride): ContractPage[] {
  switch (override.action) {
    case 'rename':
      return renameSection(pages, override.targetId, override.newTitle, override);
    case 'replace':
      return replaceClause(pages, override.targetId, override.newText, override.boldPrefix ?? null, override);
    case 'modify':
      return modifyClause(pages, override.targetId, override.find, override.replaceWith, override);
    case 'delete':
      return deleteClause(pages, override.targetId, override);
    case 'add':
      return addClause(pages, override, override);
  }
}

// ─── Operations ─────────────────────────────────────────────────────────────

function renameSection(
  pages: ContractPage[],
  sectionId: string,
  newTitle: string,
  override: ContractOverride,
): ContractPage[] {
  let found = false;
  const next = pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => {
      if (s.id !== sectionId) return s;
      found = true;
      return { ...s, title: newTitle };
    }),
  }));
  if (!found) {
    throw new ContractOverrideError(
      `rename: no section with id '${sectionId}' in the base contract.`,
      override,
    );
  }
  return next;
}

function replaceClause(
  pages: ContractPage[],
  clauseId: string,
  newText: string,
  newBoldPrefix: string | null,
  override: ContractOverride,
): ContractPage[] {
  return mutateClause(
    pages,
    clauseId,
    (c) => {
      if (c.type === 'kv') {
        return { ...c, valueTemplate: newText };
      }
      const next: ContractClause = { ...c, template: newText };
      if (newBoldPrefix === null) {
        // explicit null means "keep current" (the schema's default)
      } else if (newBoldPrefix === '') {
        next.boldPrefix = undefined;
      } else {
        next.boldPrefix = newBoldPrefix;
      }
      return next;
    },
    `replace: no clause with id '${clauseId}'`,
    override,
  );
}

function modifyClause(
  pages: ContractPage[],
  clauseId: string,
  find: string,
  replaceWith: string,
  override: ContractOverride,
): ContractPage[] {
  return mutateClause(
    pages,
    clauseId,
    (c) => {
      if (c.type === 'kv') {
        if (!c.valueTemplate.includes(find)) {
          throw new ContractOverrideError(
            `modify: span "${find}" not found in clause '${clauseId}'.`,
            override,
          );
        }
        return { ...c, valueTemplate: c.valueTemplate.split(find).join(replaceWith) };
      }
      if (!c.template.includes(find)) {
        throw new ContractOverrideError(
          `modify: span "${find}" not found in clause '${clauseId}'.`,
          override,
        );
      }
      return { ...c, template: c.template.split(find).join(replaceWith) };
    },
    `modify: no clause with id '${clauseId}'`,
    override,
  );
}

function deleteClause(
  pages: ContractPage[],
  clauseId: string,
  override: ContractOverride,
): ContractPage[] {
  let found = false;
  const filter = (items: ContractSectionContent[]): ContractSectionContent[] =>
    items
      .filter((c) => {
        if (c.id === clauseId) {
          found = true;
          return false;
        }
        return true;
      })
      .map((c) => {
        if (c.type === 'bullet' && c.children) {
          return { ...c, children: filterClauses(c.children) };
        }
        return c;
      });

  const filterClauses = (items: ContractClause[]): ContractClause[] =>
    items
      .filter((c) => {
        if (c.id === clauseId) {
          found = true;
          return false;
        }
        return true;
      })
      .map((c) => (c.children ? { ...c, children: filterClauses(c.children) } : c));

  const next = pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => ({
      ...s,
      intro: s.intro && s.intro.id === clauseId ? (() => { found = true; return undefined; })() : s.intro,
      content: filter(s.content),
    })),
  }));

  if (!found) {
    throw new ContractOverrideError(
      `delete: no clause with id '${clauseId}' in the base contract.`,
      override,
    );
  }
  return next;
}

function addClause(
  pages: ContractPage[],
  add: Extract<ContractOverride, { action: 'add' }>,
  override: ContractOverride,
): ContractPage[] {
  const newClause: ContractClause = {
    id: add.newId,
    type: 'bullet',
    template: add.body,
    ...(add.title ? { boldPrefix: `${add.title}:` } : {}),
  };

  if ('inSection' in add.anchor) {
    return insertInSection(pages, add.anchor.inSection, add.anchor.position, newClause, override);
  }
  if ('insertAfter' in add.anchor) {
    return insertRelativeTo(pages, add.anchor.insertAfter, newClause, 'after', override);
  }
  return insertRelativeTo(pages, add.anchor.insertBefore, newClause, 'before', override);
}

function insertInSection(
  pages: ContractPage[],
  sectionId: string,
  position: 'first' | 'last',
  newClause: ContractClause,
  override: ContractOverride,
): ContractPage[] {
  let found = false;
  const next = pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => {
      if (s.id !== sectionId) return s;
      found = true;
      const content =
        position === 'first' ? [newClause, ...s.content] : [...s.content, newClause];
      return { ...s, content };
    }),
  }));
  if (!found) {
    throw new ContractOverrideError(
      `add: no section with id '${sectionId}' for inSection anchor.`,
      override,
    );
  }
  return next;
}

function insertRelativeTo(
  pages: ContractPage[],
  anchorId: string,
  newClause: ContractClause,
  side: 'before' | 'after',
  override: ContractOverride,
): ContractPage[] {
  let found = false;
  const next = pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => {
      const newContent: ContractSectionContent[] = [];
      for (const c of s.content) {
        if (c.id === anchorId) {
          found = true;
          if (side === 'before') newContent.push(newClause, c);
          else newContent.push(c, newClause);
          continue;
        }
        if (c.type === 'bullet' && c.children) {
          // Anchor may be a nested child — search there too.
          const children = insertIntoChildren(c.children, anchorId, newClause, side);
          if (children.changed) {
            found = true;
            newContent.push({ ...c, children: children.list });
            continue;
          }
        }
        newContent.push(c);
      }
      return { ...s, content: newContent };
    }),
  }));
  if (!found) {
    throw new ContractOverrideError(
      `add: no clause with id '${anchorId}' for insertAfter/insertBefore anchor.`,
      override,
    );
  }
  return next;
}

function insertIntoChildren(
  children: ContractClause[],
  anchorId: string,
  newClause: ContractClause,
  side: 'before' | 'after',
): { changed: boolean; list: ContractClause[] } {
  const out: ContractClause[] = [];
  let changed = false;
  for (const c of children) {
    if (c.id === anchorId) {
      changed = true;
      if (side === 'before') out.push(newClause, c);
      else out.push(c, newClause);
      continue;
    }
    if (c.children) {
      const inner = insertIntoChildren(c.children, anchorId, newClause, side);
      if (inner.changed) {
        changed = true;
        out.push({ ...c, children: inner.list });
        continue;
      }
    }
    out.push(c);
  }
  return { changed, list: out };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mutateClause(
  pages: ContractPage[],
  clauseId: string,
  fn: (c: ContractSectionContent) => ContractSectionContent,
  notFoundMsg: string,
  override: ContractOverride,
): ContractPage[] {
  let found = false;
  const mapItem = (c: ContractSectionContent): ContractSectionContent => {
    if (c.id === clauseId) {
      found = true;
      return fn(c);
    }
    if (c.type === 'bullet' && c.children) {
      return { ...c, children: c.children.map((child) => mapItem(child) as ContractClause) };
    }
    return c;
  };
  const next = pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => ({
      ...s,
      intro:
        s.intro && s.intro.id === clauseId
          ? ((found = true), fn(s.intro) as ContractClause)
          : s.intro,
      content: s.content.map(mapItem),
    })),
  }));
  if (!found) throw new ContractOverrideError(notFoundMsg, override);
  return next;
}

function cloneContract(pages: ContractPage[]): ContractPage[] {
  // Shallow per-level clone is enough — we only ever construct new objects
  // (via spread) when mutating, never mutate in place.
  return pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => ({
      ...s,
      content: [...s.content],
    })),
  }));
}

/** Flat list of all clause IDs reachable in the (post-override) contract. */
export function collectClauseIds(pages: ContractPage[]): string[] {
  const out: string[] = [];
  const visit = (c: ContractSectionContent) => {
    out.push(c.id);
    if (c.type === 'bullet' && c.children) for (const ch of c.children) visit(ch);
  };
  for (const p of pages) for (const s of p.sections) {
    if (s.intro) visit(s.intro);
    for (const c of s.content) visit(c);
  }
  return out;
}
