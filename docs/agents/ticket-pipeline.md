# Ticket pipeline

How `/implement-spec` builds one ticket. The orchestrator (the main session) runs the ticket through a pipeline of specialist agents. Tickets stay vertical slices; the pipeline splits the *work* by layer, not the ticket.

## Stages

Run only the stages the ticket touches, in this order:

| # | Agent | When | Owns |
|---|---|---|---|
| 1 | `backend-builder` | the ticket changes the API or its data | `backend/` (Go) |
| 2 | `processing-builder` | the ticket changes photo processing | `backend/` (Python Lambdas) |
| 3 | `infra-builder` | the ticket adds or changes AWS resources, the local stack or CI | `infra/`, `.github/` |
| 4 | `frontend-designer` | the ticket adds screens or visible states | `design/MASTER.md` |
| 5 | `frontend-builder` | the ticket changes the UI | `frontend/` |
| 6 | `frontend-validator` | after stage 5 | the validation report |
| 7 | reviewers: `go-reviewer`, `python-reviewer`, `typescript-reviewer`, `security-reviewer` (always, if IAM, auth, uploads or infra changed) | after all building stages | review findings in the handoff |
| 8 | merger | after review passes | merges the ticket branch into the integration branch |

The orchestrator routes each review or validation finding back to the builder that owns that folder. Max **3 rounds** of fix and re-review per ticket. After that, stop and escalate to the human.

Builders write the end-to-end tests for their own layer. The builder whose stage comes last owns the ticket's Playwright journey, usually `frontend-builder`.

## Shared state

Every stage of a ticket works on the same branch, `feat/<spec>-<NN>-<slug>`, in one worktree created from the integration branch. Stages run one at a time, so they never edit the same tree at once.

Each ticket has a folder outside the repo: `~/.cache/viajecito-factory/tickets/<issue>/`.

- **`handoff.md`**: each stage appends a section and reads all earlier ones before starting. A section says:
  - what it built
  - the contracts the next stages rely on (API routes and payloads, resource names, environment variables)
  - how it verified its work (the commands and their results)
  - what it left open
- **`validation.md`**: written by `frontend-validator`, rewritten each round.
- **`screenshots/`**: mobile and desktop screenshots for the PR.

Shared research notes live in `~/.cache/viajecito-factory/notes/` (for example `floci.md`). Read them before working with Floci.

## Every builder

- Start by reading the ticket (`gh issue view <n>`), its parent spec, `GLOSSARY.md`, the relevant ADRs and `handoff.md`.
- Build test-first with the `tdd` skill, on the seams in the spec's Testing Decisions.
- Run your layer's checks and leave them green before handing off.
- Report each test run's pass, skip and fail counts in `handoff.md`. A skip is a failure unless the ticket explains it. (A silent `t.Skip` once hid a regression behind a green run.)
- Commit on the ticket branch with the git config identity and the session's attribution line. Never push to `main`, merge, or force-push.
- Coverage: CI measures coverage per language and fails below a floor (frontend `vite.config.ts`, Go `backend/scripts/coverage-check.sh`, Python `backend/processing/pyproject.toml`). A drop means the change needs tests; the fix is never lowering the floor. Raise a floor when coverage has gone up (round down to a whole percent, keep the "ratchet" comment). Lower one only with a note in the PR saying why.
- Floci: use the port and resource namespace the orchestrator gives you, and stop your containers when you finish.
