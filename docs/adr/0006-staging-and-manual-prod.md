# Staging deploys on merge, prod deploys by hand

Floci cannot show everything: real CloudFront (signed cookies, caching, the SPA rewrite), real Cognito emails and phone testing over HTTPS only work in the real cloud. ADR-0002 had one prod environment deployed on every merge to `main`, which makes prod the place where those things get checked first. We add a **staging** environment in the same AWS account:

- The CDK app builds two stacks from the same `AlbumStack`, chosen by a `stage` prop: `ViajecitoStg` (staging) and `Viajecito` (prod).
- Every merge to `main` that passes CI deploys **staging** on its own (`deploy-staging.yml`).
- **Prod** is deployed only when Luis runs the "Deploy to prod" workflow (`workflow_dispatch`, `deploy-prod.yml`). It deploys the commit of the latest *successful* staging deploy, not whatever `main` is when the button is pressed, so prod gets exactly what was checked. It refuses to run from any ref but `main`.
- Staging is **throwaway**: its Cognito user pool, table and buckets are destroyed with the stack (and the buckets empty themselves), so `cdk destroy ViajecitoStg` and a deploy give a fresh, empty staging. Prod keeps `RETAIN`.
- The account's one $5/month budget is created in the prod stack only (AWS budgets measure the whole account, so it covers staging too).
- Each stage has its own CloudFront signing key pair: an SSM parameter `/viajecito/<stage>/cloudfront/signing-private-key`, a repo variable `CLOUDFRONT_PUBLIC_KEY_STG` or `_PROD`, and its own key group.
- One reusable workflow (`deploy-stage.yml`) holds the three jobs (cdk deploy, frontend build with no credentials, upload and invalidate) and takes the stage and commit. Each stage has a concurrency group, so a stack never has two deploys at once.
- One OIDC deploy role serves both stages. No job uses `environment:`, so the token subject stays `<repo prefix>:ref:refs/heads/main` (GitHub's immutable form on this repo, `repo:owner@<id>/name@<id>`) and the trust policy is unchanged.

## Considered Options

- **A separate AWS account for staging.** Cleaner blast radius and a separate budget, but a second account to create, bootstrap and pay attention to, for a two-person album. Rejected for now; moving later means pointing `ViajecitoStg` at another account and role.
- **GitHub Environments with required reviewers as the prod gate.** The natural fit, but a private repo needs GitHub Enterprise for required reviewers. It would also change the OIDC subject to `environment:<name>`, forcing a trust-policy change. A `workflow_dispatch` button only people with write access can press gives the same "prod is a deliberate act" without either.
- **Prod from whatever `main` is when the button is pressed.** Simpler, but prod could ship a commit nobody had looked at on staging.

## Consequences

- Prod only ever gets a commit that deployed to staging successfully. The "Deploy to prod" run reads that commit from the name of the latest successful staging run, which carries the SHA.
- Staging has its own Members (created by the setup wizard in both user pools), so each Member gets two Cognito emails.
- Staging data is disposable. Anything worth keeping must be in prod.
- Real AWS and GitHub behaviour (the first deploy, the OIDC trust, the button) cannot be tried by agents; the first real run is the proof.
