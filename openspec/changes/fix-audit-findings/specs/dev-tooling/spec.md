## ADDED Requirements

### Requirement: Lint and format tooling is configured

The repository MUST provide ESLint and Prettier configuration with runnable scripts.

#### Scenario: Lint and format scripts run

- **WHEN** a developer runs the `lint` and `format` npm scripts
- **THEN** ESLint and Prettier MUST execute against the source files using committed config

### Requirement: A test suite runs

The repository MUST provide a test runner with at least smoke-level coverage of the `src/utils` modules.

#### Scenario: Test command runs

- **WHEN** a developer runs the `test` npm script
- **THEN** the test runner MUST execute and report pass/fail for the committed tests

### Requirement: Continuous integration runs checks

The repository MUST provide a CI workflow that runs the build, lint, and tests on push / pull request.

#### Scenario: CI workflow exists

- **WHEN** the repository is pushed
- **THEN** a workflow under `.github/workflows/` MUST run build, lint, and test steps

### Requirement: Environment config is consistent

`.env.example` MUST agree with the intended defaults and document each variable.

#### Scenario: VITE_OPENAI_IMAGE_DETAIL is reconciled

- **WHEN** `.env` and `.env.example` are compared
- **THEN** `VITE_OPENAI_IMAGE_DETAIL` MUST have a single agreed default, with the intended value documented in `.env.example`
