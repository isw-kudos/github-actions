### ECS Query — Custom GitHub Action

Query AWS ECS services, tasks, and deployments from your GitHub workflows. This Docker-based action wraps common ECS queries and returns results in multiple formats, plus exposes them as step outputs you can reuse in subsequent steps.

#### Key features
- Query ECS services, tasks, and service deployments
- Validate that a specific deployment (task definition) reached an expected rollout state
- Flexible filtering for each query type
- Multiple output formats for logs: `json`, `table`, `summary`, `compact`
- Rich step outputs: raw JSON result, a human summary, item count, and success flags for deployment checks

---

### Inputs

All inputs are passed as standard GitHub Action inputs. Some are optional and/or specific to a particular query type.

- `query-type` (required)
  - One of: `services`, `tasks`, `deployments`, `check-deployment`

- `cluster` (required)
  - ECS Cluster name.

- `service` (optional)
  - ECS Service name. Required for `deployments` and `check-deployment` queries.

- `aws-region` (required, default: `ap-southeast-2`)
  - AWS region to use.

- `filters` (optional)
  - JSON string with additional filters. See “Filters by query type” below.

- `output-format` (optional, default: `json`)
  - One of: `json`, `table`, `summary`, `compact`.

- `target-task-definition` (required for `check-deployment`)
  - Target task definition to match, as full ARN or `family:revision` (e.g., `my-task:153`).

- `expected-status` (optional for `check-deployment`, default: `COMPLETED`)
  - Expected rollout state to validate. One of: `COMPLETED`, `IN_PROGRESS`, `ROLLED_BACK`, `FAILED`.

Notes:
- The action is Docker-based and reads inputs via environment variables populated by GitHub Actions. The internal default region in code is unused if the workflow provides or defaults the `aws-region` input (from `action.yml`), so the effective default is `ap-southeast-2`.

---

### Outputs

All query types:
- `result`: The full query result encoded as JSON.
- `summary`: A human-readable summary line(s).
- `count`: Number of items found (for list responses). When the result is a single object, `count` will be `1`.

`check-deployment` only:
- `success`: Boolean indicating whether the deployment’s rollout state matches the `expected-status`.
- `rollout-state`: The rollout state actually observed.

---

### Permissions and authentication

This action uses the AWS SDK for Python (`boto3`) and expects credentials to be available in the environment. The recommended approach is GitHub OIDC with a role to assume in your AWS account.

Minimal job/workflow permissions:
```
permissions:
  id-token: write   # Required for OIDC federation
  contents: read    # Typically required by actions/checkout
```

Obtain AWS credentials (examples):
- Configure `aws-actions/configure-aws-credentials@v4` with your OIDC role
- Or provide long-lived keys as environment variables (not recommended)

Example OIDC step:
```
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::<account-id>:role/<role-name>
    aws-region: ap-southeast-2
```

---

### Filters by query type

Pass filters via the `filters` input as a JSON string. Examples are shown below for each query.

- `services` filters:
  - `status`: Match ECS service status (e.g., `ACTIVE`, `DRAINING`, `INACTIVE`).
  - `minRunning`: Minimum running task count.
  - `namePattern`: Regex to match `serviceName`.

- `tasks` filters:
  - `desiredStatus`: One of `RUNNING` or `STOPPED` (default is `RUNNING` when omitted).
  - `exitCode`: Filter by the exit code of the first container in the task.
  - `family`: Substring match against `taskDefinitionArn` family name.

- `deployments` filters:
  - `status`: Match deployment status.
  - `rolloutState`: Match rollout state (e.g., `COMPLETED`, `IN_PROGRESS`, `ROLLED_BACK`, `FAILED`).
  - `minDesired`: Minimum desired count.

---

### Usage

Add the action as a step in your workflow. Ensure you have authenticated to AWS first.

Basic example (list services as a table):
```
jobs:
  list-services:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<account-id>:role/<role-name>
          aws-region: ap-southeast-2

      - name: Query ECS services
        id: ecs
        uses: ./.github/actions/ecs-query
        with:
          query-type: services
          cluster: my-ecs-cluster
          output-format: table
          filters: |
            {"status": "ACTIVE", "namePattern": "^api-"}

      - name: Use results
        run: |
          echo "Found ${{ steps.ecs.outputs.count }} services"
          echo "Summary:\n${{ steps.ecs.outputs.summary }}"
```

List tasks for a service (running tasks only):
```
- name: Query ECS tasks
  id: tasks
  uses: ./.github/actions/ecs-query
  with:
    query-type: tasks
    cluster: my-ecs-cluster
    service: my-api-service
    output-format: summary
    filters: |
      {"desiredStatus": "RUNNING"}
```

List service deployments with filters:
```
- name: Query ECS deployments
  id: deps
  uses: ./.github/actions/ecs-query
  with:
    query-type: deployments
    cluster: my-ecs-cluster
    service: my-api-service
    output-format: compact
    filters: |
      {"rolloutState": "COMPLETED", "minDesired": 2}
```

Check a specific deployment’s rollout state:
```
- name: Check deployment status
  id: check
  uses: ./.github/actions/ecs-query
  with:
    query-type: check-deployment
    cluster: my-ecs-cluster
    service: my-api-service
    target-task-definition: my-task:153
    expected-status: COMPLETED

- name: Gate on rollout
  if: steps.check.outputs.success != 'true'
  run: |
    echo "Deployment did not reach expected state: ${{ steps.check.outputs.rollout-state }}"
    exit 1
```

Use JSON output programmatically:
```
- name: Parse JSON result
  run: |
    echo '${{ steps.ecs.outputs.result }}' > result.json
    jq '.' result.json
```

---

### Output formats

- `json`: Pretty-printed JSON (default).
- `table`: ASCII table for lists with commonly useful ECS fields.
- `summary`: One-line per item with name/identifier and status.
- `compact`: Structured, readable multi-line output per item; good for logs.

Regardless of the printed format, the step output `result` always contains the raw JSON.

---

### Notes and nuances

- For `tasks` queries, if `filters.desiredStatus` is omitted, the action queries `RUNNING` tasks by default.
- For `deployments`, the action enriches results with helpful ARNs, including `serviceRevisionArn` and `deploymentArn` when available.
- For `check-deployment`, you can specify `target-task-definition` as a full ARN or `family[:revision]`. If you pass just the family (no `:revision`), the action will match any revision with that family name.

---

### Troubleshooting

- No results returned
  - Verify the `cluster`, `service` (when required), `aws-region`, and `filters` values.
  - Ensure your IAM role has permissions for `ecs:ListServices`, `ecs:DescribeServices`, `ecs:ListTasks`, `ecs:DescribeTasks`, and `ecs:ListServiceDeployments`.

- Authentication issues
  - Confirm OIDC is configured and your role trust policy allows your GitHub org/repo.
  - Check that the job has `permissions: id-token: write`.

- Parsing filters
  - `filters` must be valid JSON. Use the `|` multi-line string in YAML and escape quotes appropriately.

---

### Local development

The action runs in a Docker container. For local testing you can invoke the entrypoint script directly with environment variables mimicking GitHub Actions inputs:

```
export INPUT_QUERY-TYPE=services
export INPUT_CLUSTER=my-ecs-cluster
export INPUT_AWS-REGION=ap-southeast-2
export INPUT_OUTPUT-FORMAT=json
export INPUT_FILTERS='{"status":"ACTIVE"}'
python3 .github/actions/ecs-query/src/main.py
```

Alternatively, build and run the Docker image in the action folder, ensuring AWS credentials are available in the environment.

---

### License

This project is released under the terms of the LICENSE at the repository root.
