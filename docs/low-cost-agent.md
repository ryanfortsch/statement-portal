# Lower-cost supporting agent

Claude Code stays primary. `helm_low_cost` is an optional GPT-6 Luna helper in
`.codex/agents/helm_low_cost.toml`, with low reasoning effort for narrow tasks.
It does not change the main Codex model or any user-level configuration. No new
provider, API key, subscription, or local model installation is required by this
repository configuration; the host still needs access to the selected model.
Actual billing and usage depend on the account. This is not a hard spending cap.

## Start with read-only work

Use it to find the files responsible for a behavior, map existing tests, summarize
one small diff, or draft a documentation/test patch in its answer. Claude or the
user reviews the result; the primary agent applies and validates any changes.
Do not assign money, auth, migrations, production integrations, or deployments to
this role. It escalates when the task crosses those boundaries.

Run from a trusted, isolated checkout containing this configuration. Existing
outdated worktrees do not acquire it automatically. Current Codex clients discover
project agents in `.codex/agents/`; restart the session if a newly added role is not
listed. If the role or model is unavailable, stop and report that fact rather than
silently falling back to a more expensive model.

In Codex, explicitly request the named agent. For a first task:

> Use the helm_low_cost agent for this read-only task. Read AGENTS.md, the Testing
> section of CLAUDE.md, package.json, and .github/workflows/property-documents.yml.
> Identify the required
> checks for a code change and whether this workflow runs on documentation-only
> PRs. Return file and line references, uncertainties, and a handoff for Claude.
> Do not run tests, edit files, access external services, or spawn more agents.

This is a Codex agent definition, not a native Claude Code subagent. When Claude
leads, use the same task brief in Codex and bring the result back to Claude. This
setup does not install a bridge or grant Claude new tool permissions.

## Task brief and review

Provide this small brief per invocation:

- Goal: one concrete question or proposed edit.
- Input files: an explicit, short list of paths.
- Acceptance criteria: what evidence or output answers the question.
- Output: findings with file/line references, or a proposed patch in the response.
- Reviewer: Claude or the user; no automatic application or integration.

Before accepting a handoff, check that references support the findings, the work
stayed within scope, and any patch is reviewed and validated under AGENTS.md.
Do not treat a read-only helper's suggestions as tested code. Try a small real task
before expanding its role; write access is deliberately outside this initial setup.

## Permissions and cost boundaries

The definition requests a read-only shell sandbox, no approval escalation, and
no web search. Its instructions also prohibit external connectors and live data.
These instructions are not a security boundary: inherited MCP/app permissions and
parent runtime overrides can change effective access. Launch with read-only
permissions and only the tools needed for local source inspection; do not use a
parent session with unrestricted permissions or production connectors enabled.
No credentials or customer exports should be present in the working checkout.

Keep each invocation small. The helper returns a blocker instead of repeated
retries, does not spawn children, and never upgrades itself to another model.
A parent still needs to stop an overlong run; there is no enforced token or dollar
budget in this configuration. Do not enable unattended delegation based on this
file alone.

## Configuration reference

The project-agent format and model guidance were checked on 2026-09-29 against
[OpenAI's subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
The local CLI inspected during setup was 0.158.0-alpha.2.1. Configuration validation
is separate from a live model invocation; a model's presence in a catalog does not
prove account entitlement or end-to-end agent discovery.
