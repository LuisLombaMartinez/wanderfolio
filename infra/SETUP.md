# Going live: what Luis does once

Viajecito has two environments in one AWS account (ADR-0006): **staging** (stack `ViajecitoStg`, a throwaway copy that deploys itself on every merge to `main`) and **prod** (stack `Viajecito`, deployed only when you press "Deploy to prod").

After this is merged to `main` (the first staging deploy run will fail until step 2 is done; that is expected):

1. On your machine, log in to AWS with admin access (`aws sso login` or an admin profile) and to GitHub (`gh auth login`).
2. Run `infra/scripts/setup-wizard.sh`. It walks through six stages, explains each one and asks before doing it; it is safe to re-run (it offers the budget email you gave last time). It bootstraps CDK once, creates one OIDC deploy role, a signing key pair per environment, deploys staging and then prod, and creates the Members in both.
3. Each Member receives **two** emails from Cognito, one per environment (staging and prod are separate user pools), each with its own temporary password. Nothing is printed by the wizard.
4. **Require CI on `main` with a ruleset.** The last stage opens `https://github.com/LuisLombaMartinez/wanderfolio/settings/rules`. Create a branch ruleset named `main`:
   - Enforcement **Active**; target **Include default branch**.
   - Bypass list: empty, or **Repository admin** with mode **For pull requests only** (merge a red PR in an emergency, never push straight to `main`).
   - Rules: **Restrict deletions**, **Block force pushes**, **Require a pull request before merging** (0 approvals; keep the **Merge** method, spec PRs use merge commits), and **Require status checks to pass** with **Require branches to be up to date**, and one check, source GitHub Actions: **CI passed**. That job always runs and goes red if any CI job failed or was cancelled; pull requests skip the jobs for areas they don't touch, and a skipped job counts as passing.
   - Leave linear history off: it would block merge commits.

   The staging deploy only starts after CI succeeds on `main`, but without the ruleset a red change can still be merged. Check it with `gh api repos/LuisLombaMartinez/wanderfolio/rulesets`.
5. How you know it worked: open the `https://<id>.cloudfront.net` address the wizard prints for prod on your phone, log in with the emailed password, choose a new one and see the Album.

## The everyday flow

1. Merge a PR to `main`. CI runs; when it is green, `.github/workflows/deploy-staging.yml` deploys that commit to staging by itself.
2. Check it on the staging address (the run summary of "Deploy to staging" in the Actions tab shows it; the wizard printed it too). Log in with a staging Member.
3. Happy? Actions tab, "Deploy to prod", "Run workflow", branch `main`. It deploys the commit of the **latest successful staging deploy**, not whatever `main` is now, and the run summary shows which SHA it deployed. It refuses to run from any other branch, and it fails if there has been no successful staging deploy.

What the button does and does not do: prod always runs `main`'s current workflow files (and deploy scripts) with the staged commit's code, and it can only promote the latest successful staging deploy. You cannot pick an older commit. To roll prod back, merge a revert to `main`, let it reach staging, and press the button again.

Two deploys never run at the same time on the same stack (one concurrency group per environment). A newer staging deploy waits for the running one.

## Resetting staging

Staging is disposable: its user pool, table and buckets are deleted with the stack, and the buckets empty themselves. To start fresh, with admin credentials:

```
cd infra
VIAJECITO_STAGE=stg CLOUDFRONT_PUBLIC_KEY_STG="$(gh api repos/LuisLombaMartinez/wanderfolio/actions/variables/CLOUDFRONT_PUBLIC_KEY_STG --jq .value)" npx cdk destroy ViajecitoStg
```

then merge anything to `main` (or re-run the last "Deploy to staging" run) to deploy a fresh, empty staging. The staging signing key in SSM and the repo variable stay.

**Re-run the wizard right after the redeploy, or the upload will fail.** A new staging stack has a new site bucket and a new CloudFront distribution, and the deploy role is only allowed to publish to the ones it knew about (the policy is scoped to those exact IDs, on purpose). Until you re-run `infra/scripts/setup-wizard.sh` (stage 2 refreshes the role's policy from the live stacks), the "Upload the site" job fails with AccessDenied; the stack itself is deployed, so just re-run that workflow run afterwards. The same re-run re-creates the staging Members, who are gone with the user pool (it skips what exists; they get a new Cognito email). Never destroy `Viajecito`: prod keeps its data on deletion and its user pool is protected.

## Auto-merge Dependabot updates (optional)

`.github/workflows/dependabot-auto-merge.yml` turns on auto-merge for Dependabot minor and patch PRs (never for GitHub Actions updates, which run inside the deploy jobs). The merge still waits for the required checks in the `main` ruleset. It uses a GitHub App token so the merge counts as a push by the App: CI then runs on `main` and the staging deploy follows. (A merge made with `GITHUB_TOKEN` starts no workflows.) Until you do this, the workflow skips auto-merge with a notice and does not fail.

1. Create the App: GitHub, Settings, Developer settings, GitHub Apps, New GitHub App, owned by your account. Uncheck **Webhook active**. Repository permissions: **Contents** read and write, **Pull requests** read and write. Install only on your account.
2. Install it: **Only select repositories**, choose `viajecito`. Add the App to nothing else, and do not add it to the `main` ruleset bypass list (auto-merge must wait for the checks).
3. On the App page note the **Client ID**, then **Generate a private key** (a `.pem` file downloads).
4. Store both as **Dependabot** secrets (not Actions secrets: the auto-merge workflow runs on `pull_request`, and a `pull_request` run that Dependabot triggers only sees Dependabot secrets). The Client ID goes there too because Dependabot-triggered workflows are not documented to read repository variables.

```bash
gh secret set AUTOMERGE_APP_CLIENT_ID --app dependabot --repo LuisLombaMartinez/wanderfolio
gh secret set AUTOMERGE_APP_PRIVATE_KEY --app dependabot --repo LuisLombaMartinez/wanderfolio < /path/to/the-key.pem
```

Type the Client ID when `gh` prompts. Then delete the `.pem` file; never commit it.

5. Check it: after the next Dependabot minor or patch PR, the "Dependabot auto-merge" run shows "Create App token" and "Enable auto-merge", the PR shows "Auto-merge enabled", and after it merges, CI and "Deploy to staging" start on `main`.

## Notes

Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm, Go, GitHub Actions (keeping the SHA pins current) and the Floci image. In the repo settings, Code security, turn on "Dependabot alerts" and "Dependabot security updates" so vulnerability fixes arrive too; the version updates work without it.

Invitations expire after 7 days; re-send with `RESEND_INVITES=1 infra/scripts/setup-wizard.sh`.

The budget ($5/month, alerts at 80% actual, 100% actual and 100% forecast) is created once, in the prod stack. AWS budgets measure the whole account, so it covers staging too.

If you ever add an `environment:` to a job in a deploy workflow, the OIDC subject changes and the deploy role's trust policy (wizard stage 2) must be updated to match.

Repo variables the workflows read (the wizard sets them): `AWS_ROLE_ARN`, `AWS_REGION`, `BUDGET_ALERT_EMAIL` (prod only), `CLOUDFRONT_PUBLIC_KEY_STG`, `CLOUDFRONT_PUBLIC_KEY_PROD`.
