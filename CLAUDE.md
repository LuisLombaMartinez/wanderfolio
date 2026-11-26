# Viajecito — software factory

A private photo album of the trips two partners make together. It started (Phase 1) as a one-page invitation to a trip. It is also the trial of the "software factory": specialised agents that hand work to each other through files.

## Direction (2026-11-09)
Phase 2 turns the invitation page into the album: two Members, Trips with Photos, and reusable Invitations to a new Trip. The decisions came out of a `grill-with-docs` session. The vocabulary is in `GLOSSARY.md` and the architecture choices are in `docs/adr/`; read both before planning or building. The Phase 2 specs are GitHub issues: #5 Album (release 1, tickets #7–#13) and #6 Invitations (release 2). `specs/PRODUCT.md` and `design/MASTER.md` still describe Phase 1 only.

**Layout (monorepo):**
- `frontend/`: React web app (its own `package.json`; run npm commands there).
- `backend/`: the Go API (one Lambda) and the Python photo-processing Lambdas.
- `infra/`: AWS CDK in TypeScript.
- Shared factory files at the root: `.claude/`, `specs/`, `design/`, `reports/`, `docs/`, `GLOSSARY.md`.

**Local stack:** `infra/scripts/local-up.sh` starts Floci, deploys the CDK app to it, creates two test Members (`leo@viajecito.test`, `ana@viajecito.test`, temporary password `Temporal#2026`) and writes `frontend/.env.local`; `infra/scripts/local-down.sh` stops it. Set `FLOCI_PORT`, `FLOCI_NAMESPACE` and `SPA_PORT` to run several stacks side by side. Then `go test ./...` in `backend/` (with `AWS_ENDPOINT_URL=http://localhost:$FLOCI_PORT`) and `npm run e2e` in `frontend/` (with `SPA_PORT`).

## Stack
- **Frontend:** React + Vite + Tailwind + shadcn/ui. Animation: GSAP with `useGSAP`, the only animation library.
- **Backend:** Go API behind API Gateway (HTTP API), written as a plain `net/http` server with a Lambda adapter. Photo processing is a Step Functions workflow of Python Lambdas (ADR-0004). Data lives in DynamoDB (ADR-0003). Photos live in a private S3 bucket. Login is Cognito.
- **Hosting:** serverless AWS, one CloudFront distribution per environment serving the app, `/api/*` and `/media/*` (ADR-0002). Two environments in one account: a throwaway staging (`ViajecitoStg`) that deploys on every merge to `main`, and prod (`Viajecito`), deployed by hand with the "Deploy to prod" workflow (ADR-0006).
- **Local stack and e2e:** the CDK app deployed to Floci, including Floci's Cognito (ADR-0005).

## Ticket pipeline

`/implement-spec` builds each ticket by running it through specialist agents, one per layer: `backend-builder` (Go), `processing-builder` (Python), `infra-builder` (CDK, local stack, CI), `frontend-designer`, `frontend-builder`, `frontend-validator`, then the reviewers and a merger. It doesn't hand the ticket to one generic implementer. Each ticket runs only the stages it touches, and the stages hand off through per-ticket files. Stages, order, handoff format and fix routing: `docs/agents/ticket-pipeline.md`.

New screens get their design from the `frontend-designer` inside the same PR as the first ticket that needs them. The user reviews the design and the built screens together in that PR. There is no separate design pause.

## Rules
- Agents communicate only through files, never through shared conversation.
- Deterministic checks first (build, lint, tests for each language, `cdk synth`); LLM judgment only after.
- **Language:** all user-facing copy is in **Spanish**, with a romantic and playful tone. Everything else (agents, instructions, specs, design file, reports, code, comments) is in **English**.
- Use Taste (`design-taste-frontend`) for frontend design; Impeccable stays out of this repo because it clashes with Taste.
- Always check mobile (390x844) and `prefers-reduced-motion`. The user judges animations by eye, so every UI PR includes mobile and desktop screenshots.
- Every Photo comes from a Member's upload. The UI shows a styled placeholder where a Photo is missing.
- **AWS:** agents work with no AWS credentials. Verify with unit tests, CDK assertion tests, `cdk synth` and the Floci local stack. Deploys happen only through GitHub Actions: staging on every merge to `main`, prod when the human runs the "Deploy to prod" workflow, which ships the commit staging is running (ADR-0006). When Floci differs from AWS, work around it in tests and note it in the PR; production code stays the same.
- Auth always goes through Cognito (real in prod, Floci locally). The backend has no fake-auth or bypass mode.

## Tooling
- **Planning flow (Matt Pocock skills):** `grill-with-docs` / `domain-modeling` (interview, glossary, ADRs), `to-spec`, `to-tickets`, `implement-spec` / `implement`, with `tdd`, `code-review`, `diagnosing-bugs`, `codebase-design`, `improve-codebase-architecture`, `ask-matt` and `handoff` as needed. Matt's skills are the base for design and planning.
- **Go:** `go-reviewer`, `go-build-resolver` (when a Go build fails); skills `golang-patterns`, `golang-testing`, `api-design`.
- **Python:** `python-reviewer`; skills `python-patterns`, `python-testing`.
- **TypeScript (frontend and CDK):** `typescript-reviewer`; skill `typescript-patterns`. Frontend skills: `react-patterns`, `react-testing`, `react-performance`, `accessibility`, `e2e-testing`.
- **AWS (official, `aws/agent-toolkit-for-aws`):** `aws-cdk`, `amazon-dynamodb`, `aws-step-functions`, `processing-s3-uploads-with-step-functions`, `connecting-lambda-to-api-gateway`, `cloudfront`, `securing-s3-buckets`, `aws-iam`. Their live-AWS steps (deploy, benchmark) are out of reach by design; use them for design and review.
- **Cross-cutting (ECC):** `security-reviewer` (also reviews IAM and infra changes), `e2e-runner` (Playwright), `refactor-cleaner`, `performance-optimizer`; skills `security-review`, `docker-patterns`.
- ECC agent descriptions say "use during implementation" (rewritten from "MUST BE USED"). Call them from the implementation flow (`implement-spec`), once per change set.
- Not installed on purpose: ECC's `planner`, `architect`, `tdd-guide` (overlap with Matt's skills), `frontend-patterns` (conflicts with GSAP), the Postgres tooling (`database-reviewer`, `postgres-patterns`, `database-migrations`; the data is in DynamoDB), and ECC's rules and hooks.
- **Models and effort:** every agent in `.claude/agents/` pins its own in frontmatter: Sonnet at medium, except `frontend-designer` on Opus. Pass these explicitly when spawning:
  - mergers: Haiku at low. On a real conflict they stop and report, and a stronger agent resolves it.
  - final `code-review` fixes: the builder that owns the folder.
  - a spec's walking-skeleton ticket, which creates the folders and patterns the specialists then work inside: one generalist on Opus at medium.
- Third-party skills are restored locally from `skills-lock.json` and are not committed; only our own skills under `.claude/skills/` are tracked.
- New agents and skills are only loaded after restarting Claude Code in this folder.

## How the factory runs (operating model, decided 2026-11-09)
The factory works on its own in a loop. The human (Luis) takes part in **only two places**:
1. **Spec definition:** `grill-with-docs` -> `domain-modeling` -> `to-spec` -> `to-tickets`. The interview, the spec and the ticket breakdown are where the human decides what gets built.
2. **Final human review:** a pull request that the agents have already implemented, tested and reviewed.

Everything in between is autonomous: pick up a `ready-for-agent` ticket, `implement-spec` / `implement` with `tdd`, the language and cross-cutting reviewers, fix, repeat, and open a PR. Rules for the loop:
- Agents may commit, push branches and open PRs in this repo. **They never merge**: merging is the final human review. No force-push, no direct commits to `main` for feature work.
- **One PR per spec**, through `/implement-spec`: an integration branch per spec (e.g. `feat/album`), a branch per ticket merged into it, and a single PR from the integration branch that closes the spec and all its tickets. A lone ticket outside a spec gets its own branch and PR.
- The spec PR lists each ticket with what was verified for it. Nothing reaches `main` (or prod) until the whole spec is done and reviewed.
- Open PRs against `main`. A PR stacked on another branch lands in that branch when merged, not in `main`. If you stack one anyway, say so at the top of the description.
- Each PR description says what changed, what was verified (tests, build, lint, reviews) and anything left uncertain.
- Max **3 rounds** of implement <-> review per PR. If it still fails, stop and escalate to the human with the report, instead of looping.
- Don't ask the human questions mid-loop that the spec already answers. If the spec is silent on something that changes behaviour, pick the least surprising option, note it in the PR, and carry on; ask only when it can't be undone cheaply.
- Commits use the git identity from config (Luis Lomba) plus the attribution line the session requires.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `LuisLombaMartinez/wanderfolio` (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

One domain context: a single root `GLOSSARY.md`, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
