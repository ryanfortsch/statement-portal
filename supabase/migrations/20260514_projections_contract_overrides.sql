-- Action-aware contract overrides for the Prospects redline engine.
--
-- The previous redlines path only knew how to append clauses to a Rider
-- page (via projections.custom_clauses). That collapsed every owner
-- redline into an appendix even when the request was a replace / rename
-- / modify against the existing body. The 36 Granite St May 2026 retro
-- documents the resulting unusable contracts.
--
-- This column holds a structured list of {action, targetId, ...} edits
-- that the contract renderer dispatches on. Schema lives in
-- src/lib/contract-overrides.ts (ContractOverride union). JSONB so the
-- LLM-produced shape can evolve without further migrations.
--
-- custom_clauses stays for backward compat — projections created before
-- this infra still render their Rider page when contract_overrides is
-- null AND custom_clauses is non-empty.

alter table public.projections
  add column if not exists contract_overrides jsonb;
