<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


# Shared agent instructions

These rules apply to Claude Code, Codex, and any future agent working on Helm.
Claude remains the primary agent. These instructions are a working agreement, not
an access-control system; tool permissions and CI must enforce their own limits.

## Read before working

- Read this file first, then the relevant sections of `CLAUDE.md`, regardless of
  which agent you are. `CLAUDE.md` remains the canonical business and architecture
  reference; its name does not make those rules Claude-only. Do not recursively
  reload its `@AGENTS.md` import.
- Read `SCHEMA.md` before database work. It owns the table map; `CLAUDE.md` owns
  business rules. Keep those details in their existing home rather than copying
  them into agent-specific files.
- Inspect the current branch, status, and worktree list before editing. Verify
  the main-branch reference is current; do not assume the local `main` or an old
  checkout reflects today's code or tests.

## Roles and handoffs

- Claude Code leads architecture, cross-cutting work, and integration review.
- Codex handles explicitly scoped implementation, tests, audits, and reviews.
  Return the branch, base commit, changed files, checks run, and remaining risks
  for Claude or the user to review. Do not expand scope into unrelated cleanup.
- A future lower-cost agent starts with bounded documentation, mechanical edits,
  or isolated pure-logic tests with clear acceptance criteria. Give it an explicit
  file scope and require Claude or user review before integration. Money, auth,
  migrations, production integrations, deployment, and ambiguous failures go back
  to Claude or the user. No model or provider is selected by this document.
- Do not start other agents or resume another session without user authorization.
  Stopped sessions and old worktrees may still contain unfinished work.
- If a tool does not automatically load `AGENTS.md`, supply this file explicitly
  in its startup prompt and ask it to identify its scope and required checks.

## Preserve work

- Use an isolated branch/worktree based on verified current `origin/main` for new
  work. Reuse an existing worktree only when its ownership and changes are accounted
  for; do not switch or update someone else's checkout to make it current.
- Preserve staged, unstaged, untracked, and unpushed work. Do not reset, clean,
  stash, prune, remove worktrees, or delete branches as incidental setup.
- Stage only your own named files. Never use broad staging across shared work.
- Do not copy `.env` files, credentials, or customer data into a new worktree.

## Data and sensitive changes

- Default to source inspection and synthetic/local fixtures. Live customer-data
  access, production API calls, and database operations require explicit user
  authorization for that task. A read-only query still accesses customer data.
- Do not print secrets or place customer records in prompts, logs, fixtures, or PRs.
- Before touching any `owner_payout` writer, read the full money chapter in
  `CLAUDE.md`. Revenue, fee, payout, and Stripe-fee rewrites require explicit user
  approval plus a parity harness. Preserve this existing rule for every agent.
- Inspect scripts before executing them. Some parity/audit scripts require a
  service-role key and live data; they are not interchangeable with local tests.

## Verification and deployment

- Use Node 24 or newer, matching `package.json` and CI. For code changes, run
  `npm test` and `npx tsc --noEmit` before committing, plus relevant synthetic smoke
  checks. Put pure-logic tests in `src/lib/__tests__/`, with explicit `.ts` imports.
- For documentation-only changes, inspect the complete diff, check referenced
  paths, and run `git diff --check`; application tests are unnecessary unless the
  change affects executable configuration or test behavior. Report that exemption.
- Report checks actually run and failures honestly. Never bypass a failed gate or
  describe a historical green result as validation of the current branch.
- Main auto-deploys to Vercel. Do not push to main, merge, deploy, apply migrations,
  or change production settings without explicit user authorization. Approval to
  prepare a PR is not approval to merge it.
- A branch push or PR may trigger a Vercel preview. If deployment is prohibited,
  verify preview suppression before pushing; otherwise prepare the commit and PR
  description locally and ask the user how to proceed.
- Preserve deployment-skew protections and auth boundaries. Documentation of a
  platform setting is not proof of its current state, and a CI workflow existing
  is not proof that branch protection requires it.
