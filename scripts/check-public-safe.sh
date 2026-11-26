#!/usr/bin/env bash
# Fails if a tracked file holds personal data that must never reach the public repo (#72):
# a real person's name, a real email, a path from a developer machine, or an AWS account id.
# Personal content is data entered through the app, never code. Run from anywhere in the repo.
#
# Third-party skills are not committed (see skills-lock.json); lockfiles hold only
# hashes. Fixtures use the fictional Members Ana and Leo, with @viajecito.test emails.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

exclude=(':!**/package-lock.json' ':!**/go.sum')
failed=0

check() {
  local what="$1" pattern="$2" hits
  local rc=0
  # git grep exits 1 when nothing matches (the passing case) and 2 or more on an error.
  hits="$(git grep -n -I -i -P "$pattern" -- . "${exclude[@]}")" || rc=$?
  if (( rc > 1 )); then
    echo "check-public-safe: git grep failed ($rc) on the $what check" >&2
    exit 2
  fi
  if [[ -n "$hits" ]]; then
    printf 'check-public-safe: %s found:\n%s\n\n' "$what" "$hits" >&2
    failed=1
  fi
}

# Names and paths are written with character classes so this script does not match itself.
check "a real person's name" '\b[c]ris(tina)?\b'
check "relationship framing" '\b([n]ovia|[g]irlfriend)\b'
# Allowed: *.test and example.* domains, GitHub noreply addresses and the git@github.com remote.
check "an email that is not a test address" \
  '[A-Za-z0-9._%+-]+@(?!([A-Za-z0-9-]+\.)*(test|example\.(com|org|net)|users\.noreply\.github\.com)\b)(?!github\.com\b)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b'
check "a path from a developer machine" '(?-i)(/[h]ome/[A-Za-z]|/[U]sers/[A-Za-z]|\b[A-Za-z]:\\{1,2}Users\b)'
# Twelve digits on their own; the placeholder ids used by tests and Floci are allowed.
check "an AWS account id" '(?<![0-9A-Za-z+/=._-])(?!0{12}(?![0-9])|1{12}(?![0-9])|123456789012(?![0-9]))[0-9]{12}(?![0-9A-Za-z+/=_-])'

if (( failed )); then
  echo "check-public-safe: FAILED. Move personal content out of the code (see issue #72)." >&2
  exit 1
fi
echo "check-public-safe: OK"
