#!/bin/sh
# PostToolUse hook: lint GitHub Actions workflow files with actionlint
# whenever Claude edits one — syntax, expression/context validity and
# shellcheck of `run:` blocks. Same ruleset as the pre-commit hook and CI's
# actionlint.yml gate (shellcheck only runs if it is on PATH; pre-commit and
# CI always have it).
set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null) || exit 0

case "$FILE" in
  */.github/workflows/*.yml | */.github/workflows/*.yaml) ;;
  *) exit 0 ;;
esac

[ -f "$FILE" ] || exit 0

# Pinned actionlint-py version (<actionlint>.<package build>). Renovate bumps
# this in lockstep with the actionlint.yml pin and the pre-commit `rev:` (the
# "actionlint" group in renovate.json), so the hook always lints with the
# same CLI as CI.
ACTIONLINT_VERSION=1.7.12.25
ACTIONLINT_CLI_VERSION=${ACTIONLINT_VERSION%.*}

# Only use a system actionlint if it is the pinned CLI version; otherwise
# fetch the pin via uvx so a stale local install can't lint with a different
# ruleset.
if command -v actionlint >/dev/null 2>&1 &&
  [ "$(actionlint -version 2>/dev/null | head -n 1)" = "$ACTIONLINT_CLI_VERSION" ]; then
  set -- actionlint
elif command -v uvx >/dev/null 2>&1; then
  set -- uvx --from "actionlint-py==$ACTIONLINT_VERSION" actionlint
else
  # No matching runner available — pre-commit and CI still enforce.
  exit 0
fi

if ! OUTPUT=$("$@" -no-color "$FILE" 2>&1); then
  {
    echo "actionlint found problems in $FILE — fix the workflow (see .claude/skills/gha-security/SKILL.md §5); do not silence findings without a justified ignore entry in .github/actionlint.yaml:"
    echo "$OUTPUT"
  } >&2
  exit 2
fi

exit 0
