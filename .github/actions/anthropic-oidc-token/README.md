# anthropic-oidc-token

Composite action that exchanges the job's GitHub OIDC token for a
short-lived Anthropic access token. The exchange uses an Anthropic Workload
Identity Federation rule that trusts the repository's GitHub OIDC token, so
the repository stores only non-secret IDs and no long-lived Anthropic
credential.

The action:

1. Requests a GitHub OIDC token with the audience `https://api.anthropic.com`.
2. Posts it as a JWT-bearer grant to `https://api.anthropic.com/v1/oauth/token`
   with the organization, workspace, service account and federation rule IDs.
3. Masks the returned `access_token` and sets it as the `access-token` output.

## Usage

```yaml
jobs:
  claude:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # OIDC token for the Anthropic exchange
    steps:
      - id: anthropic-auth
        uses: isw-kudos/github-actions/.github/actions/anthropic-oidc-token@<sha> # anthropic-oidc-token-vX.Y.Z
        with:
          organization-id: ${{ vars.ANTHROPIC_ORGANIZATION_ID }}
          workspace-id: ${{ vars.ANTHROPIC_WORKSPACE_ID }}
          service-account-id: ${{ vars.ANTHROPIC_SERVICE_ACCOUNT_ID }}
          federation-rule-id: ${{ vars.ANTHROPIC_FEDERATION_RULE_ID }}

      # anthropics/claude-code-action
      - uses: anthropics/claude-code-action@<sha> # vX.Y.Z
        with:
          claude_code_oauth_token: ${{ steps.anthropic-auth.outputs.access-token }}

      # or the Claude Code CLI
      - env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ steps.anthropic-auth.outputs.access-token }}
        run: claude -p "..."
```

## Inputs

| Input | Required | Purpose |
|---|---|---|
| `organization-id` | yes | Anthropic organization that owns the service account |
| `workspace-id` | yes | Anthropic workspace the token is scoped to |
| `service-account-id` | yes | Anthropic service account the token is issued for |
| `federation-rule-id` | yes | Federation rule that trusts this repository's GitHub OIDC token |

The IDs are not secrets. Keep them in repository or organization variables.

## Outputs

| Output | Value |
|---|---|
| `access-token` | The Anthropic access token, masked in the job log |

## Prerequisites

- **`id-token: write` on the calling job.** Without it the runner has no OIDC
  token endpoint, and the action fails with an error that names the missing
  permission.
- **A federation rule on the Anthropic side** that trusts GitHub's OIDC
  issuer (`https://token.actions.githubusercontent.com`) for the audience
  `https://api.anthropic.com`, and whose conditions match the calling
  repository's token claims.
- `curl` and `jq` on the runner (present on GitHub-hosted runners).

## Failures

The action fails the step, and does not set the output, when:

- an input is empty (for example an unset repository variable). The runner
  does not enforce `required: true` on action inputs, so the action checks
  them and names each empty input;
- the job has no `id-token: write` permission, or GitHub returns no OIDC token;
- the token endpoint returns a status other than 200 (the error response body
  is logged);
- a 200 response has no `access_token` (the body is not logged, because it is a
  credential response).
