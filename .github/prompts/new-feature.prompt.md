---
mode: agent
description: Walk through the 5-step feature contract before writing any code for a new Flux feature.
---

# New Feature — 5-Step Contract

You are about to implement (or modify) a feature in Flux. **Do not write
code yet.** First, fill in the contract below. Only after I approve the
plan do you write code.

## Inputs from me

- Feature name and feature number from `docs/feature_spec.md` (e.g.,
  "F5 Tasks"). If the feature isn't in `feature_spec.md`, propose adding it
  and stop until I confirm.
- Trigger (UI action, watcher event, command palette, plugin call, …).

## Read first

Before writing the plan, you MUST read:

- `docs/feature_spec.md` — find the matching F-number
- `docs/architecture.md` §3 — find the matching sequence diagram
- `docs/tech_stack.md` — confirm dependencies exist
- `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1 — the non-negotiable rules
- `docs/LLM_ANTIHALLUCINATION.md` §3 — banned APIs / patterns
- `docs/skills/feature-implementation.md` — the canonical 5-step contract

## Produce this plan (verbatim template)

```
## Feature: <name> (F<NN>)

### 1. Disk
- Files touched: <paths or glob>
- Write mode: <atomic temp+rename | append | none>
- Crash safety: <what happens mid-write>
- Path safety: <sanitization done>
- Triggers Wikilink Healer? <yes/no, where>

### 2. Index
- Tables touched: <names from docs/architecture.md §2>
- New migration: <crates/zenvault-db/migrations/NNN_<title>.sql | none>
- IDs: <UUID v7 BLOB(16)>
- Anchors: <if block-level, how anchors regenerate>
- Tx mode: <BEGIN IMMEDIATE for writes>

### 3. UI
- Route/panel: <where in the app>
- New components: <src/features/<feature>/...>
- State: <react-query keys, zustand store slice, or component-local>
- Keyboard shortcut: <name + Command Palette label>
- Loading state: <explicit>
- Empty state: <explicit>
- Offline behavior: <works fully offline>

### 4. Command
- Command(s):
  - `<rust_command_name>(input: <T>) -> Result<<U>, AppError>`
- DTOs live in: <zenvault-domain::<module>>
- Registered in: src-tauri/src/main.rs
- bindings.ts regenerated: <yes — by build hook>

### 5. Failure
- Modes:
  - <mode 1> → <typed AppError variant or fallback>
  - <mode 2> → ...
- Deterministic fallback if AI involved: <Feature 8 mechanic>
- Tests:
  - unit: <file>
  - integration: <file, what it asserts>
```

## Refusal triggers

Stop the plan and ask me if:

- The change touches more than one feature area in `feature_spec.md`.
- A required library isn't in `docs/tech_stack.md`.
- A rule in `docs/LLM_SYSTEM_INSTRUCTIONS.md` §1 would have to bend.
- You can't verify a library or API signature.

## After I approve

- Implement following the path-scoped rules in `.github/instructions/`.
- Update `docs/feature_spec.md` with any spec changes.
- Add an ADR if a new dependency is involved.
- Run the verified commands from `.github/copilot-instructions.md` to
  validate.
- Show me diffs, not full files.
