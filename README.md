# Workflow Templates

This repository contains reusable GitHub Actions workflows for CI/CD, infrastructure automation, and other DevOps tasks. These workflows can be shared across multiple repositories to maintain consistency and reduce duplication.

## 📌 Why Use This Repository?
- **Reusability** – Centralized workflows reduce duplication across repositories.
- **Consistency** – Ensures uniform CI/CD practices across projects.
- **Maintainability** – Updates to workflows propagate to all using repositories.

## 🚀 Usage

To use a workflow from this repository in another GitHub Actions workflow, reference it using the `uses` keyword:

```yaml
jobs:
  deploy:
    uses: ISW-Cloud42/workflow-templates/.github/workflows/deploy.yml@main
    with:
      environment: production
      digest: ${{ inputs.digest }}
    secrets:
      AWS_ROLE_ARN: ${{ secrets.AWS_ROLE_ARN }}
