# Serverless on AWS, defined with CDK

The album has two users, so it should cost close to nothing when idle. We host it on AWS serverless services: S3 + CloudFront for the web app and photos, API Gateway (HTTP API) + one Go Lambda for the backend, Cognito for login, and Step Functions for photo processing. All of it is defined with CDK in TypeScript in `infra/`. Deploys go through GitHub Actions (OIDC role, no stored keys). There are two environments, a throwaway staging and prod, in one account: see [ADR-0006](0006-staging-and-manual-prod.md), which replaces the original "single prod environment, deployed on merge to `main`".

## Considered Options

- **One small VPS with Docker Compose** (Go + Postgres + reverse proxy): cheap and vendor-neutral, but a fixed monthly bill, a server to patch, and backups to run ourselves.
- **Managed PaaS** (Fly.io, Railway): simpler than AWS, but not free at rest once a database and storage are added.

## Consequences

- The Go service is written as a plain `net/http` server behind a Lambda adapter, so it also runs locally and in tests without AWS.
- Lock-in to AWS is accepted; moving off means rewriting `infra/` and the photo pipeline, not the domain code.
