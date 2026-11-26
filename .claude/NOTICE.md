# Where the factory's agents and skills come from

The agent factory in `.claude/` builds on other people's open work. Thank you to them.

## Adapted from Everything Claude Code (`affaan-m/everything-claude-code`)

These started as ECC agents and skills and were adapted to this factory's workflow (Matt Pocock's skills: specs, tickets, `tdd`, `code-review`) and its file-based handoffs. They are no longer identical to upstream.

- Agents: `go-reviewer`, `go-build-resolver`, `python-reviewer`, `typescript-reviewer`, `security-reviewer`, `e2e-runner`, `refactor-cleaner`, `performance-optimizer`.
- Skills: `accessibility`, `api-design`, `docker-patterns`, `e2e-testing`, `golang-patterns`, `golang-testing`, `react-patterns`, `react-performance`, `react-testing`, `security-review`.

## Installed unmodified, not committed

The skills listed in `skills-lock.json` come from their upstream repos (`mattpocock/skills`, `aws/agent-toolkit-for-aws`, `greensock/gsap-skills`, `affaan-m/everything-claude-code`, `leonxlnx/taste-skill`, `nextlevelbuilder/ui-ux-pro-max-skill`, `vercel-labs/agent-skills`). They are restored locally from the lock file and are not part of this repo.

## Written for this factory

The stage agents (`backend-builder`, `processing-builder`, `infra-builder`, `frontend-designer`, `frontend-builder`, `frontend-validator`) and the pipeline docs in `docs/agents/`.
