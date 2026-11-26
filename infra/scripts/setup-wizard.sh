#!/usr/bin/env bash
#
# Viajecito setup wizard (built from the /wizard skill template). Luis runs this ONCE, on his own
# machine, with AWS admin credentials (for example `aws sso login` or an admin profile) and a logged-in
# `gh` CLI. Agents never run it against real AWS. It is safe to re-run.
#
# Stages, in order. Each says what it will do, checks the stage before it, and can be re-run:
#   1. cdk bootstrap in eu-west-1 (once, for both environments)
#   2. GitHub OIDC provider + one deploy role for this repo, and the GitHub repo variables
#   3. a CloudFront signing key pair per environment, staging and prod (private key -> SSM SecureString,
#      public key -> repo variable CLOUDFRONT_PUBLIC_KEY_STG / CLOUDFRONT_PUBLIC_KEY_PROD)
#   4. first deploy of staging, then of prod (cdk deploy, then build and upload the site)
#   5. the two Members, in BOTH user pools (each gets two Cognito emails, one per environment)
#   6. a ruleset on main (manual, in the browser): only green changes are merged
#
# Two environments live in this one account (ADR-0006): staging (stack ViajecitoStg, deploys itself on
# every merge to main, throwaway) and prod (stack Viajecito, deployed by the manual "Deploy to prod" workflow).
#
# Secrets: the private key is written to a private temp dir, loaded into SSM and shredded; it is never
# printed or committed. Temporary passwords are generated and emailed by Cognito; this script never sees them.
#
# Settings (all optional; the wizard asks for what is missing):
#   GITHUB_REPO          owner/name (default: LuisLombaMartinez/wanderfolio)
#   BUDGET_ALERT_EMAIL   where the $5/month budget alerts go (default: the repo variable of that name)
#   MEMBER1_EMAIL MEMBER1_NAME MEMBER2_EMAIL MEMBER2_NAME
#   WIZARD_YES=1         do not pause for confirmations
#   RESEND_INVITES=1     stage 5: re-send the Cognito invitation to Members who have not logged in yet
#   WIZARD_SKIP_SITE_CHECK=1  skip the stage 4 HTTP check (Floci has no public CloudFront domain)
#   AWS_ENDPOINT_URL     point every aws call at Floci (used to test the wizard locally)
#
# Everything above the STAGES marker is the wizard library, identical in every wizard: do not hand-edit it.

# shellcheck disable=SC1087,SC2329 # the unmodified wizard library has unused helpers and a colour-code idiom
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1 && tput clear 2>/dev/null; then return 0; fi
  printf '\033[2J\033[3J\033[H'
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else false; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any, with write_env's single
# quotes or a plain dotenv double-quoted value undone.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line value sq="'\\''"; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  value="${line#*=}"
  if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//"$sq"/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    [[ "$value" == *[\\\$\"]* ]] && return 1   # escapes, $ or ": can't decode safely; ask again
  fi
  printf '%s' "$value"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret), edited
# with Readline. Fails at EOF with no input.
ask() {
  local key="$1" prompt="$2" current input s=$'\001' e=$'\002' p rc=0
  current=$(_existing "$key" || true)
  # Readline needs the colour codes wrapped in \001..\002 to place the cursor.
  p="  $s$BOLD$e$prompt$s$RESET$e "
  [[ -n "$current" ]] && p+="$s$DIM$e[Enter keeps current]$s$RESET$e "
  read -e -r -p "$p" input || rc=1
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input rc=0
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || rc=1
  printf '\n'
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY='VALUE' into ENV_FILE (replaces any existing
# line) and sets $KEY. Idempotent. Creates ENV_FILE at mode 0600; writes through
# a symlink and keeps an existing file's mode.
write_env() {
  local key="$1" value="$2" tmp sq="'\\''"
  [[ -e "$ENV_FILE" ]] || (umask 077 && : > "$ENV_FILE")
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "${value//\'/$sq}" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  printf -v "$key" '%s' "$value"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE sets a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

# set_var NAME VALUE sets a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES
# ──────────────────────────────────────────────────────────────────────────

REGION="eu-west-1"
ROLE_NAME="viajecito-github-deploy"
OIDC_HOST="token.actions.githubusercontent.com"
ENVIRONMENTS=(stg prod) # staging first: the first deploy of prod only comes after staging works
CDK_QUALIFIER="hnb659fds" # the CDK default bootstrap qualifier
GITHUB_REPO="${GITHUB_REPO:-LuisLombaMartinez/wanderfolio}"

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""
export GH_REPO="$GITHUB_REPO" # every gh call targets this repo, whatever the current directory

# The library's ask/write_env keep remembered values here. It only ever holds non-secret answers and
# lives for one run; the durable memory of a re-run is the GitHub repo variables.
ENV_FILE="$(mktemp)"
WORK_DIR=""
wipe_work_dir() {
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    find "$WORK_DIR" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf "$WORK_DIR"
  fi
  WORK_DIR=""
}
cleanup() { wipe_work_dir; rm -f "$ENV_FILE"; }
trap cleanup EXIT

# The per-environment names. They match infra/lib/album-stack.ts (signingKeyParam), infra/bin/app.ts
# and infra/lib/deploy-config.ts (publicKeyVar); the CDK tests pin the SSM names.
stack_of() { case "$1" in stg) printf ViajecitoStg ;; prod) printf Viajecito ;; *) return 1 ;; esac; }
ssm_param_of() { printf '/viajecito/%s/cloudfront/signing-private-key' "$1"; }
key_var_of() { case "$1" in stg) printf CLOUDFRONT_PUBLIC_KEY_STG ;; prod) printf CLOUDFRONT_PUBLIC_KEY_PROD ;; *) return 1 ;; esac; }
label_of() { case "$1" in stg) printf staging ;; prod) printf prod ;; *) return 1 ;; esac; }

die() { printf '\n  ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed or not on PATH."; }

# gate "question": a y/N gate that stops the wizard on "no". WIZARD_YES=1 answers yes.
gate() {
  [ "${WIZARD_YES:-}" = "1" ] && return 0
  confirm "${1:-Continue?}" || die "Stopped by you. Nothing after this point was changed; re-run when ready."
}

# need_value VAR "Question": keeps a value already in the environment, otherwise asks.
need_value() {
  if [ -n "${!1:-}" ]; then return 0; fi
  ask "$1" "$2" || die "$1 is required."
  [ -n "${!1:-}" ] || die "$1 is required."
}

# stack_output STAGE KEY prints one output of that stage's stack; fails when it is missing, empty or the
# CLI's literal "None".
stack_output() {
  local value stack
  stack="$(stack_of "$1")"
  value="$(aws cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text)" || return 1
  case "$value" in "" | None | null) echo "stack ${stack} has no output $2" >&2; return 1 ;; esac
  printf '%s' "$value"
}

# stack_deployed STAGE: the stage's stack exists AND holds a deployed template. A first deploy that
# failed leaves the stack in ROLLBACK_COMPLETE with no resources or outputs; that counts as not deployed
# (cdk deploy deletes and re-creates it). In-progress states count as not deployed too.
stack_deployed() {
  local status
  status="$(aws cloudformation describe-stacks --stack-name "$(stack_of "$1")" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null)" || return 1
  case "$status" in
    CREATE_COMPLETE | UPDATE_COMPLETE | UPDATE_ROLLBACK_COMPLETE | IMPORT_COMPLETE | IMPORT_ROLLBACK_COMPLETE) return 0 ;;
    *) note "$(stack_of "$1") is ${status}: no site permissions for it yet." >&2; return 1 ;;
  esac
}

# public_key_from_ssm STAGE prints the public key (PEM) for the private key stored in SSM. The key only flows through the pipe.
public_key_from_ssm() {
  aws ssm get-parameter --name "$(ssm_param_of "$1")" --with-decryption \
    --query Parameter.Value --output text | openssl rsa -pubout 2>/dev/null
}

# The deploy role may assume ONLY the CDK bootstrap roles this deploy uses (deploy, file-publishing,
# lookup; there are no image assets, and cfn-exec is passed to CloudFormation by the deploy role, not
# assumed by us). It may read the two stacks, and for each stack that already exists, publish to that
# stack's site bucket and invalidate that stack's distribution. It reads the stacks that exist from AWS.
put_deploy_policy() {
  local statements role_arns="" stacks="" r stage bucket distribution
  : "${ACCOUNT_ID:?ACCOUNT_ID is not set}"
  for r in deploy file-publishing lookup; do
    role_arns="${role_arns:+$role_arns,}\"arn:aws:iam::${ACCOUNT_ID}:role/cdk-${CDK_QUALIFIER}-${r}-role-${ACCOUNT_ID}-${REGION}\""
  done
  for stage in "${ENVIRONMENTS[@]}"; do
    stacks="${stacks:+$stacks,}\"arn:aws:cloudformation:${REGION}:${ACCOUNT_ID}:stack/$(stack_of "$stage")/*\""
  done
  statements='{"Effect":"Allow","Action":"sts:AssumeRole","Resource":['"$role_arns"']},
    {"Effect":"Allow","Action":"cloudformation:DescribeStacks","Resource":['"$stacks"']}'
  for stage in "${ENVIRONMENTS[@]}"; do
    stack_deployed "$stage" || continue
    bucket="$(stack_output "$stage" SiteBucketName)" || die "The $(stack_of "$stage") stack exists but has no SiteBucketName output."
    distribution="$(stack_output "$stage" DistributionId)" || die "The $(stack_of "$stage") stack exists but has no DistributionId output."
    statements="$statements"',
    {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::'"$bucket"'"},
    {"Effect":"Allow","Action":["s3:PutObject","s3:DeleteObject"],"Resource":"arn:aws:s3:::'"$bucket"'/*"},
    {"Effect":"Allow","Action":"cloudfront:CreateInvalidation","Resource":"arn:aws:cloudfront::'"$ACCOUNT_ID"':distribution/'"$distribution"'"}'
  done
  aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name deploy \
    --policy-document '{"Version":"2012-10-17","Statement":['"$statements"']}'
}

# gh variables are set with the gh CLI directly (not the library's set_var) so a failure stops the
# wizard instead of being deferred to the closing summary.
gh_var() { gh variable set "$1" --body "$2" >/dev/null || die "Could not set the GitHub variable $1 on ${GITHUB_REPO}. Check your gh permissions."; }
# Read through the REST API: `gh variable get` is missing from older gh (Ubuntu's apt ships 2.45).
# A missing variable prints nothing (gh api would print the 404 body on stdout).
gh_var_get() { local v; v="$(gh api "repos/${GITHUB_REPO}/actions/variables/$1" --jq .value 2>/dev/null)" && printf '%s\n' "$v"; return 0; }

preflight() {
  local r
  for r in aws gh jq openssl node npm go; do need "$r"; done
  [[ "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
    || die "GITHUB_REPO must look like owner/name (letters, digits, '_', '.', '-'); got '${GITHUB_REPO}'."
  gh auth status >/dev/null 2>&1 || die "Run 'gh auth login' first."
  ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)" \
    || die "No AWS credentials. Log in with admin access first (for example 'aws sso login')."
  : "${ACCOUNT_ID:?}"
  # On a re-run the budget email is remembered in the GitHub variable: offer it instead of asking again.
  if [ -z "${BUDGET_ALERT_EMAIL:-}" ]; then
    r="$(gh_var_get BUDGET_ALERT_EMAIL)"
    [ -z "$r" ] || write_env BUDGET_ALERT_EMAIL "$r" >/dev/null
  fi
}

create_member() { # create_member STAGE EMAIL NAME
  local stage="$1" email="$2" name="$3" pool table sub status where
  where="$(label_of "$stage")"
  pool="$(stack_output "$stage" UserPoolId)" || die "No UserPoolId output on $(stack_of "$stage")."
  table="$(stack_output "$stage" TableName)" || die "No TableName output on $(stack_of "$stage")."
  if status="$(aws cognito-idp admin-get-user --user-pool-id "$pool" --username "$email" --query UserStatus --output text 2>/dev/null)"; then
    note "${name} (${where}): Cognito user exists (${status})."
    if [ "$status" = "FORCE_CHANGE_PASSWORD" ] && [ "${RESEND_INVITES:-}" = "1" ]; then
      aws cognito-idp admin-create-user --user-pool-id "$pool" --username "$email" --message-action RESEND >/dev/null
      note "${name} (${where}): invitation re-sent."
    fi
  else
    # No temporary password is passed: Cognito generates one and emails it to the Member.
    aws cognito-idp admin-create-user --user-pool-id "$pool" --username "$email" \
      --user-attributes "Name=email,Value=${email}" "Name=email_verified,Value=true" \
      --desired-delivery-mediums EMAIL >/dev/null
    note "${name} (${where}): Cognito user created; Cognito emailed the temporary password."
  fi
  sub="$(aws cognito-idp admin-get-user --user-pool-id "$pool" --username "$email" \
    --query "UserAttributes[?Name=='sub'].Value | [0]" --output text)"
  case "$sub" in "" | None | null) die "Could not read the Cognito sub of ${email} (${where})." ;; esac
  # seed-member is an upsert keyed on the Cognito sub: re-running never creates a second record.
  (cd "$REPO_DIR/backend" && go run ./cmd/seed-member -table "$table" -id "$sub" -name "$name")
}

run_wizard() {

TOTAL_STAGES=6
preflight
banner "Viajecito: go live"

# ── Stage 1 ───────────────────────────────────────────────────────────────
stage "cdk bootstrap"
say "AWS account ${ACCOUNT_ID}, region ${REGION}, GitHub repo ${GITHUB_REPO}"
need_value BUDGET_ALERT_EMAIL "Email for the \$5/month budget alerts:"
[[ "$BUDGET_ALERT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || die "That does not look like an email address: ${BUDGET_ALERT_EMAIL}"
note "Budget alerts go to ${BUDGET_ALERT_EMAIL} (stored only as a GitHub repo variable)."
say "Creates the CDK toolkit stack (CDKToolkit) in ${REGION}: the bucket and roles CDK deploys through."
note "One bootstrap serves both environments (staging and prod share this account)."
note "Safe to re-run: bootstrapping an already bootstrapped account only updates it."
note "(VIAJECITO_LOCAL=1 only tells the CDK app to skip its deploy-time settings; bootstrap deploys no app resources.)"
gate "Bootstrap now?"
(cd "$INFRA_DIR" && { [ -d node_modules ] || npm ci --ignore-scripts; } && env -u BUDGET_ALERT_EMAIL -u CLOUDFRONT_PUBLIC_KEY_STG -u CLOUDFRONT_PUBLIC_KEY_PROD VIAJECITO_LOCAL=1 npx cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}")
aws cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus' --output text \
  | grep -Eq 'CREATE_COMPLETE|UPDATE_COMPLETE' || die "The CDKToolkit stack is not healthy. Fix it, then re-run."
note "OK: CDKToolkit is deployed."

# ── Stage 2 ───────────────────────────────────────────────────────────────
stage "GitHub OIDC provider, deploy role and repo variables"
aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1 || die "Stage 1 did not finish (no CDKToolkit stack). Re-run the wizard."
# The subject GitHub puts in this repo's OIDC tokens. Newer repos use the immutable form, with owner and
# repo IDs (repo:owner@123/name@456:...); older ones repo:owner/name:... . Ask GitHub instead of guessing.
oidc_sub_prefix() {
  local custom use_default prefix
  custom="$(gh api "repos/${GITHUB_REPO}/actions/oidc/customization/sub" 2>/dev/null)" \
    || die "Could not read the OIDC subject settings of ${GITHUB_REPO} (gh api .../actions/oidc/customization/sub)."
  use_default="$(jq -r '.use_default' <<<"$custom")"
  [ "$use_default" = "true" ] \
    || die "${GITHUB_REPO} has a customised OIDC subject template; this wizard only supports the default one."
  prefix="$(jq -r '.sub_claim_prefix // empty' <<<"$custom")"
  printf '%s' "${prefix:-repo:${GITHUB_REPO}}"
}
OIDC_SUB="$(oidc_sub_prefix):ref:refs/heads/main"
say "Creates (if missing) the IAM OIDC provider for GitHub Actions, and the role '${ROLE_NAME}'."
say "One role serves both environments. Only workflow runs whose OIDC token has this exact subject can assume it:"
step "${OIDC_SUB}"
note "(If a deploy workflow ever gains an 'environment:', that subject changes and this trust policy must change too.)"
note "The role may only assume the CDK bootstrap roles for deploy, file publishing and lookup,"
note "plus site publishing for each environment (added in stage 4). Then the repo variables the deploy workflow reads are set."
gate "Create the role?"
provider_arn="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_HOST}"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$provider_arn" >/dev/null 2>&1; then
  note "OIDC provider already exists."
else
  # IAM requires a thumbprint but AWS ignores it for GitHub (it trusts GitHub's certificate through its
  # own CA library); this is GitHub's published value and is not a security control.
  aws iam create-open-id-connect-provider --url "https://${OIDC_HOST}" --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  note "OIDC provider created."
fi
trust='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"'"$provider_arn"'"},"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{"'"$OIDC_HOST"':aud":"sts.amazonaws.com","'"$OIDC_HOST"':sub":"'"$OIDC_SUB"'"}}}]}'
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$trust"
  note "Deploy role already exists; trust policy refreshed."
else
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$trust" \
    --description "Viajecito deploy from GitHub Actions (main only)" --max-session-duration 3600 >/dev/null
  note "Deploy role created."
fi
# If a stack already exists (a re-run), put_deploy_policy keeps its publishing permissions.
put_deploy_policy
ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)"
gh_var AWS_ROLE_ARN "$ROLE_ARN"
gh_var AWS_REGION "$REGION"
gh_var BUDGET_ALERT_EMAIL "$BUDGET_ALERT_EMAIL"
[ "$(gh_var_get AWS_ROLE_ARN)" = "$ROLE_ARN" ] || die "GitHub variable AWS_ROLE_ARN was not set. Check your gh permissions on ${GITHUB_REPO}."
[ "$(gh_var_get BUDGET_ALERT_EMAIL)" = "$BUDGET_ALERT_EMAIL" ] || die "GitHub variable BUDGET_ALERT_EMAIL was not set."
note "OK: role ${ROLE_ARN} and the repo variables are in place."

# ── Stage 3 ───────────────────────────────────────────────────────────────
stage "CloudFront signing key pairs (staging and prod)"
[ -n "$(gh_var_get AWS_ROLE_ARN)" ] || die "Stage 2 did not finish (no AWS_ROLE_ARN variable). Re-run the wizard."
say "Generates an RSA 2048 key pair for each environment. The PRIVATE key goes into SSM Parameter Store as a"
say "SecureString (one parameter per environment) and is then wiped from this machine. The PUBLIC key becomes"
say "the repo variable CLOUDFRONT_PUBLIC_KEY_STG / CLOUDFRONT_PUBLIC_KEY_PROD, which CDK puts in that environment's"
say "CloudFront key group. The two environments never share a key. Nothing is printed."
for env in "${ENVIRONMENTS[@]}"; do step "$(ssm_param_of "$env")"; done
note "If a parameter already exists it is kept (replacing it would invalidate signed cookies)."
gate "Generate and store the keys?"
for env in "${ENVIRONMENTS[@]}"; do
  param="$(ssm_param_of "$env")"
  if aws ssm get-parameter --name "$param" >/dev/null 2>&1; then
    note "$(label_of "$env"): private key already in SSM; reusing it."
  else
    WORK_DIR="$(mktemp -d)"
    chmod 700 "$WORK_DIR"
    (umask 077 && openssl genrsa -out "$WORK_DIR/private.pem" 2048 2>/dev/null)
    aws ssm put-parameter --name "$param" --type SecureString --value "file://$WORK_DIR/private.pem" \
      --description "Viajecito ${env} CloudFront signing key (private)" >/dev/null
    wipe_work_dir
    note "$(label_of "$env"): private key stored and wiped locally."
  fi
  public_key="$(public_key_from_ssm "$env")"
  case "$public_key" in "-----BEGIN PUBLIC KEY-----"*) ;; *) die "Could not derive the ${env} public key from SSM." ;; esac
  gh_var "$(key_var_of "$env")" "$public_key"
  [ -n "$(gh_var_get "$(key_var_of "$env")")" ] || die "GitHub variable $(key_var_of "$env") was not set."
done
# The single-environment variable of the earlier workflow (never deployed): drop it so it cannot mislead.
if [ -n "$(gh_var_get CLOUDFRONT_PUBLIC_KEY)" ]; then
  gh variable delete CLOUDFRONT_PUBLIC_KEY >/dev/null 2>&1 || warn "Could not delete the old CLOUDFRONT_PUBLIC_KEY variable; delete it by hand."
fi
note "OK: a private key per environment in SSM, the public keys in the repo variables."

# ── Stage 4 ───────────────────────────────────────────────────────────────
stage "First deploy: staging, then prod"
for env in "${ENVIRONMENTS[@]}"; do
  aws ssm get-parameter --name "$(ssm_param_of "$env")" >/dev/null 2>&1 || die "Stage 3 did not finish (no ${env} signing key in SSM). Re-run the wizard."
done
say "Runs 'cdk deploy' for ViajecitoStg (staging) and then Viajecito (prod), lets the deploy role publish to each"
say "new site bucket, then builds the frontend against each and uploads it. Takes about 10 minutes per"
say "environment (CloudFront is slow). After this, every merge to main deploys staging by itself and prod"
say "is deployed with the manual \"Deploy to prod\" workflow. Prod also creates the account's one \$5 budget."
gate "Deploy now?"
SITE_URL=""
for env in "${ENVIRONMENTS[@]}"; do
  step "Deploying $(label_of "$env") ($(stack_of "$env"))"
  public_key="$(public_key_from_ssm "$env")"
  # Only this environment's settings are given to CDK (VIAJECITO_STAGE); the budget email is prod's alone.
  (cd "$INFRA_DIR" && env -u BUDGET_ALERT_EMAIL -u CLOUDFRONT_PUBLIC_KEY_STG -u CLOUDFRONT_PUBLIC_KEY_PROD \
    VIAJECITO_STAGE="$env" BUDGET_ALERT_EMAIL="$BUDGET_ALERT_EMAIL" "$(key_var_of "$env")=$public_key" \
    npx cdk deploy "$(stack_of "$env")" --require-approval never)
  bucket="$(stack_output "$env" SiteBucketName)" || die "The deploy produced no SiteBucketName output."
  distribution="$(stack_output "$env" DistributionId)" || die "The deploy produced no DistributionId output."
  put_deploy_policy
  pool_id="$(stack_output "$env" UserPoolId)" || die "The deploy produced no UserPoolId output."
  client_id="$(stack_output "$env" UserPoolClientId)" || die "The deploy produced no UserPoolClientId output."
  # Build first (it runs project code), upload second; build-site.sh needs no AWS access.
  VITE_USER_POOL_ID="$pool_id" VITE_USER_POOL_CLIENT_ID="$client_id" bash "$INFRA_DIR/scripts/build-site.sh"
  SITE_BUCKET="$bucket" DISTRIBUTION_ID="$distribution" bash "$INFRA_DIR/scripts/upload-site.sh"
  domain="$(stack_output "$env" DistributionDomainName)" || die "The deploy produced no DistributionDomainName output."
  url="https://${domain}"
  if [ "${WIZARD_SKIP_SITE_CHECK:-}" = "1" ]; then
    note "Skipping the HTTP check (WIZARD_SKIP_SITE_CHECK=1, for Floci)."
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url/" || true)"
    [ "$code" = "200" ] || die "The $(label_of "$env") site at ${url} answered ${code}, expected 200. CloudFront may still be warming up; re-run in a minute."
    note "OK: ${url} is up."
  fi
  SITE_URL="${SITE_URL}${SITE_URL:+, }$(label_of "$env"): ${url}"
done

# ── Stage 5 ───────────────────────────────────────────────────────────────
stage "The two Members, in both environments"
for env in "${ENVIRONMENTS[@]}"; do
  stack_output "$env" UserPoolId >/dev/null || die "Stage 4 did not finish (no $(stack_of "$env") stack). Re-run the wizard."
done
say "Creates a Cognito user for each Member in each environment's user pool (staging and prod are separate)"
say "and saves their Member record with the display name shown in the Album. Skips anyone who already exists."
warn "Each Member gets TWO emails from Cognito, one per environment, each with its own temporary password."
note "The staging one is for trying changes; the prod one is the real login."
need_value MEMBER1_EMAIL "Member 1 email:"
need_value MEMBER1_NAME "Member 1 display name:"
need_value MEMBER2_EMAIL "Member 2 email:"
need_value MEMBER2_NAME "Member 2 display name:"
gate "Create the Members?"
for env in "${ENVIRONMENTS[@]}"; do
  create_member "$env" "$MEMBER1_EMAIL" "$MEMBER1_NAME"
  create_member "$env" "$MEMBER2_EMAIL" "$MEMBER2_NAME"
  pool="$(stack_output "$env" UserPoolId)"
  for email in "$MEMBER1_EMAIL" "$MEMBER2_EMAIL"; do
    aws cognito-idp admin-get-user --user-pool-id "$pool" --username "$email" >/dev/null || die "Cognito user ${email} is missing in $(label_of "$env")."
  done
  table="$(stack_output "$env" TableName)" || die "No TableName output on $(stack_of "$env")."
  count="$(aws dynamodb scan --table-name "$table" --select COUNT \
    --filter-expression "begins_with(pk, :p)" --expression-attribute-values '{":p":{"S":"MEMBER#"}}' \
    --query Count --output text 2>/dev/null || echo "?")"
  case "$count" in '' | '?' | None | *[!0-9]*) die "Could not count the Member records in $(label_of "$env") (got '${count}')." ;; esac
  [ "$count" -ge 2 ] || die "Only ${count} Member record(s) found in $(label_of "$env"), expected 2. Re-run the wizard."
  note "OK: $(label_of "$env"): ${count} Member records."
done

# ── Stage 6 ───────────────────────────────────────────────────────────────
stage "Ruleset on main"
say "Staging deploys after CI succeeds on main, but nothing stops a red change from being merged."
say "Make CI a required check so only green changes reach main."
open_url "https://github.com/${GITHUB_REPO}/settings/rules"
step "New branch ruleset 'main': Active, target the default branch (infra/SETUP.md step 4 has every setting)."
step "Rules: restrict deletions, block force pushes, require a pull request, require status checks (up to date)."
step "The one required check: CI passed (it fails if any CI job failed; jobs a PR does not touch are skipped)."
pause "Press Enter when it is saved"

WRITTEN_ENV=() # only the throwaway answers file was written; keep it out of the summary
finish
note "Sites: ${SITE_URL}"
note "Open the prod one on your phone and log in with the email and temporary password from the prod Cognito email."
note "You will be asked to choose a new password. From now on every green merge to main deploys staging by itself;"
note "check it there, then run the \"Deploy to prod\" workflow (Actions tab) to promote that same commit."
note "If you ever destroy and redeploy staging (cdk destroy ViajecitoStg), its bucket and distribution IDs change and the"
note "deploy role may not publish to the new ones: re-run this wizard (stage 2 refreshes the policy) or the upload fails with AccessDenied."
}

run_wizard "$@"; exit
