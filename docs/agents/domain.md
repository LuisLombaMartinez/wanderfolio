# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: the single domain vocabulary for the whole repo (frontend, backend and infra share it).
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. Decisions that only matter to one part may also live in `frontend/docs/adr/`, `backend/docs/adr/` or `infra/docs/adr/`; check those too.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo is a monorepo with **one domain context**. The folders split the code by technology, not by domain, so there is one glossary at the root.

```
/
├── GLOSSARY.md                        ← the one domain glossary
├── docs/adr/                          ← system-wide decisions
├── frontend/                          ← React + Vite web app
│   └── docs/adr/                      ← frontend-only decisions (optional)
├── backend/                           ← Go service (AWS Lambda)
│   └── docs/adr/                      ← backend-only decisions (optional)
└── infra/                             ← AWS CDK (TypeScript)
    └── docs/adr/                      ← infra-only decisions (optional)
```

Don't create a `GLOSSARY-MAP.md` or per-folder `GLOSSARY.md` files. If a genuinely separate domain context appears later, decide that explicitly with `/domain-modeling` first.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
