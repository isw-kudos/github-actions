#!/usr/bin/env bash
# commit-msg hook: rejects commits that touch a versioned component's files
# without the matching conventional-commit scope, which would silently skip
# the semantic-release trigger.
set -euo pipefail

COMMIT_MSG_FILE="$1"
commit_subject=$(head -1 "$COMMIT_MSG_FILE")

# Skip merge, revert, fixup, squash commits
case "$commit_subject" in
  Merge*|Revert*|fixup!*|squash!*) exit 0 ;;
esac

# Extract scope from "type(scope): subject" — empty string if no scope
scope=$(echo "$commit_subject" | sed -n 's/^[a-z]*(\([^)]*\))!\{0,1\}:.*/\1/p')

staged=$(git diff --cached --name-only)
[ -z "$staged" ] && exit 0

required_scopes=""

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .github/workflows/claude-code-review.yml)
      required_scopes="$required_scopes claude-code-review" ;;
    .github/workflows/cleanup-images-ghcr.yml)
      required_scopes="$required_scopes cleanup-images-ghcr" ;;
    .github/workflows/determine-image-digest.yml)
      required_scopes="$required_scopes determine-image-digest" ;;
    .github/workflows/docker-build.yml)
      required_scopes="$required_scopes docker-build" ;;
    .github/workflows/docker-build-ghcr.yml)
      required_scopes="$required_scopes docker-build-ghcr" ;;
    .github/workflows/ecs-deploy.yml|.github/actions/ecs-query/*)
      required_scopes="$required_scopes ecs-deploy" ;;
    .github/workflows/helm-deploy.yml)
      required_scopes="$required_scopes helm-deploy" ;;
    .github/workflows/retag-images-ghcr.yml)
      required_scopes="$required_scopes retag-images-ghcr" ;;
    .github/workflows/tofu-pre-commit.yml)
      required_scopes="$required_scopes tofu-pre-commit" ;;
    .github/actions/turbo-repo-cache/*|.github/workflows/turbo-repo-cache-test.yml)
      required_scopes="$required_scopes turbo-repo-cache" ;;
    .github/actions/wait-for-required-checks/*)
      required_scopes="$required_scopes wait-for-required-checks" ;;
  esac
done <<< "$staged"

# Deduplicate
required_scopes=$(echo "$required_scopes" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ' | xargs)
[ -z "$required_scopes" ] && exit 0

scope_count=$(echo "$required_scopes" | wc -w | tr -d ' ')

if [ "$scope_count" -gt 1 ]; then
  echo ""
  echo "ERROR: Staged files span multiple versioned components: $required_scopes"
  echo "  A conventional commit supports only one scope — split into separate commits."
  echo "  To skip: git commit --no-verify"
  exit 1
fi

if [ "$scope" != "$required_scopes" ]; then
  echo ""
  echo "ERROR: Component scope mismatch."
  echo "  Staged component:  $required_scopes"
  echo "  Commit scope:      ${scope:-(none)}"
  echo ""
  echo "  Fix the commit subject to:"
  echo "    <type>($required_scopes): <description>"
  echo ""
  echo "  To skip: git commit --no-verify"
  exit 1
fi
