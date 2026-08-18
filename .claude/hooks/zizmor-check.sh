#!/bin/sh
# PostToolUse hook: audit GitHub Actions workflow/action files with zizmor
# whenever Claude edits one. Offline + regular persona to match the
# pre-commit hook and CI's zizmor.yml gate.
set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null) || exit 0

case "$FILE" in
  */.github/workflows/*.yml | */.github/workflows/*.yaml | */.github/actions/*.yml | */.github/actions/*.yaml) ;;
  *) exit 0 ;;
esac

[ -f "$FILE" ] || exit 0

if command -v zizmor >/dev/null 2>&1; then
  set -- zizmor
elif command -v uvx >/dev/null 2>&1; then
  set -- uvx zizmor@1.29.0
else
  # No runner available — pre-commit and CI still enforce.
  exit 0
fi

if ! OUTPUT=$("$@" --persona regular --offline "$FILE" 2>&1); then
  {
    echo "zizmor found security issues in $FILE — fix the workflow (see .claude/skills/gha-security/SKILL.md); do not silence findings without a justified '# zizmor: ignore[rule]' comment:"
    echo "$OUTPUT"
  } >&2
  exit 2
fi

exit 0
