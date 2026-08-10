# Calldiff PR Comment

Run [calldiff](https://github.com/tanishqkancharla/calldiff) for every pull request and keep the call-flow diff in one easy-to-scan PR comment.

The action compares the PR's exact base and head commits, updates the same comment after each push, writes the result to the GitHub Actions job summary, and does not install or execute your project's dependencies.

## Quick start: fastest and cheapest

Add `.github/workflows/calldiff.yml` to your project:

```yaml
name: Calldiff

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: calldiff-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  calldiff:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - name: Check out the pull request
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # A PR merge commit plus both parents is enough for calldiff and is
          # much cheaper than downloading the repository's entire history.
          fetch-depth: 2
          persist-credentials: false

      - name: Comment with the call-flow diff
        uses: ldub/calldiff-action@v1
```

That is all the configuration needed. `pull-requests: write` lets the action create its comment; `contents: read` is enough to check out and analyze the code.

`@v1` follows backwards-compatible releases and is the recommended pin for most projects. Use `@v1.0.0` or a full commit SHA when your workflow requires an immutable version.

## Common options

Path filters are the biggest speed control for large monorepos. Entrypoints are optional; when omitted, calldiff infers exported functions whose call trees changed.

```yaml
- uses: ldub/calldiff-action@v1
  with:
    paths: |
      src
      packages/api
    entrypoints: |
      App.start
      Worker.run
    max-depth: 8
    fail-on-warnings: 'true'
```

Calldiff follows calls only inside the selected paths. A narrow path list is faster, but it can hide calls that cross out of those paths, so the action never guesses a changed-files filter for you.

### Choose how calldiff updates

The action version and calldiff version are intentionally separate:

```yaml
# Default: the exact calldiff release tested with this action version.
- uses: ldub/calldiff-action@v1

# Automatically use every newly published calldiff release.
- uses: ldub/calldiff-action@v1
  with:
    calldiff-version: latest
    comment: 'false'

# Explicit version. This uses the tested lock when it matches this action release.
- uses: ldub/calldiff-action@v1
  with:
    calldiff-version: 0.4.1
```

`tested` is the default and currently resolves to `0.4.1`. The core package's npm dependency graph is committed in `runtime/package-lock.json` and installed with `npm ci`; explicitly requesting that same version reuses the lock. Dependabot checks for new calldiff packages daily, while a separate daily canary exercises `latest`. This lets maintainers review a small lockfile update and move `v1` after CI passes, without coupling calldiff's fast release cadence to wrapper-code changes.

Direct, single-job comment runs intentionally accept only that reviewed lock. Other exact versions and dynamic tags such as `latest` resolve npm code at run time and therefore require `comment: 'false'`; their result still appears in the job summary and outputs, and the write-capable token step is never started. To keep the one-job path, update the tested lock and publish the next action release.

Calldiff installs most language grammars on demand, and upstream currently requests those grammar packages without exact versions. That means even `tested` does not make a first run for every language fully bit-for-bit reproducible. The action isolates the grammar cache and records warnings when a grammar cannot load.

### Use `latest` and still comment with runner isolation

This repository also ships a reusable workflow that analyzes and comments in two jobs on fresh runners. The analysis job has only `contents: read`; it transfers the size-capped Markdown as a short-lived artifact, and only the second job receives `pull-requests: write`. Use it when you want automatic calldiff updates or a stronger boundary around on-demand grammars:

```yaml
name: Calldiff

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

concurrency:
  group: calldiff-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  calldiff:
    if: github.event.pull_request.draft == false
    permissions:
      contents: read
      pull-requests: write
    uses: ldub/calldiff-action/.github/workflows/calldiff.yml@v1
    with:
      calldiff-version: latest
```

The isolated workflow accepts the same common analysis and comment options. Its security boundary costs a second job startup and artifact transfer; use the direct quick start when the reviewed `tested` version and minimum billed runtime matter more.

When a future calldiff release adds an option before this action adds a first-class input, pass it safely as a JSON argument array:

```yaml
- uses: ldub/calldiff-action@v1
  with:
    calldiff-version: latest
    comment: 'false'
    extra-args-json: '["--new-option", "value"]'
```

Arguments are passed directly to the process without a shell. The action reserves output and ref flags because it needs a predictable, colorless result for the PR comment.

## Fork pull requests and Dependabot

GitHub gives `pull_request` workflows from forks and Dependabot a read-only `GITHUB_TOKEN`, even when the workflow requests `pull-requests: write`. Calldiff still runs and the result still appears in the job summary, but GitHub will block the PR comment. The action tolerates that failure only when the event identifies a fork or Dependabot PR. Missing permissions, invalid tokens, API outages, and malformed comment files fail by default so a silently missing comment cannot look successful; set `fail-on-comment-error: 'false'` if summary-only fallback is preferable for those cases too.

Do not switch the quick-start workflow to `pull_request_target` and then check out the PR head. That would expose a write-capable workflow to untrusted code. Repositories that must comment on fork PRs should use GitHub's two-workflow `pull_request` → artifact → `workflow_run` pattern, where the privileged workflow only reads and comments with a size-validated text artifact and never executes it. See [GitHub's `workflow_run` artifact example](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#using-data-from-the-triggering-workflow).

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `token` | `github.token` | Token used for PR comments. Needs `pull-requests: write`. |
| `calldiff-version` | `tested` | `tested`, an exact npm version (0.4.0+), or `latest`, `next`, `beta`, or `canary`. Values outside the tested lock require `comment: 'false'`. |
| `base-ref` | PR base SHA | Before ref. Required outside a `pull_request` event. |
| `head-ref` | PR head SHA | After ref. Required outside a `pull_request` event. |
| `pr-number` | Event PR number | PR to comment on. |
| `post-comment-file` | empty | Advanced comment-only mode used to post a generated file from an isolated job; skips analysis. |
| `working-directory` | `.` | Checkout path relative to `GITHUB_WORKSPACE`; analysis is normalized to its Git root. |
| `paths` | all paths | Path prefixes, one per line. |
| `entrypoints` | inferred | Functions or methods, one per line. |
| `max-depth` | `12` | Maximum call-tree depth, from 1 to 100. |
| `extra-args-json` | `[]` | Safe JSON array for new calldiff options. |
| `comment` | `true` | Create a PR comment; the job summary is always written. |
| `update-comment` | `true` | Keep one sticky comment instead of posting repeatedly. |
| `comment-header` | `## calldiff` | Markdown heading for the result. |
| `max-comment-length` | `60000` | UTF-8 byte cap below GitHub's comment limit. The result file remains complete. |
| `fail-on-error` | `true` | Fail on installation, ref, or calldiff execution errors. Diffs are not errors. |
| `fail-on-warnings` | `false` | Fail when a parser or grammar warning makes analysis potentially incomplete. |
| `fail-on-comment-error` | `true` | Fail on unexpected comment failures. Detected read-only fork and Dependabot PRs remain non-fatal. |
| `timeout-seconds` | `300` | Per-command timeout, from 10 to 3600 seconds. |

## Outputs

| Output | Description |
| --- | --- |
| `calldiff-version` | Exact installed version. |
| `exit-code` | Calldiff process exit code. |
| `has-changes` | `true`, `false`, or `unknown`. |
| `has-warnings` | Whether calldiff emitted warnings. |
| `result-file` | Runner-local complete text result for later steps in the same job. |
| `comment-file` | Runner-local size-capped Markdown used for commenting or transfer to a fresh job. |
| `comment-id` / `comment-url` | Sticky comment identifiers when commenting succeeds. |
| `commented` | Whether a comment was created or updated. |
| `truncated` | Whether the displayed comment and summary were capped. |

Example of uploading the complete result when the PR comment is truncated:

```yaml
- id: calldiff
  uses: ldub/calldiff-action@v1

- name: Upload complete calldiff result
  if: steps.calldiff.outputs.truncated == 'true'
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  with:
    name: calldiff-result
    path: ${{ steps.calldiff.outputs.result-file }}
    retention-days: 3
```

Pin third-party actions to a full commit SHA in security-sensitive repositories. The examples pin GitHub's checkout action; you can likewise replace `@v1` with a calldiff-action release commit SHA for an immutable workflow.

## How it stays fast and cheap

- It is a small composite wrapper, not a Docker image, so there is no image build or pull.
- Node 24 is selected explicitly because calldiff requires Node 22 or newer; hosted runners normally satisfy this from their tool cache.
- The published calldiff package is installed in an isolated runner-temporary directory. Your project dependencies and lifecycle scripts are never run.
- In the one-job path, the write-capable comment step runs only with this release's reviewed core lock. npm and calldiff do not receive the token in their child-process environment; this is a trust policy, not an operating-system sandbox between steps.
- The reusable workflow puts analysis and commenting on fresh runners when a hard job boundary is worth the second job startup.
- `fetch-depth: 2` downloads the PR merge commit and its two parents instead of full history.
- Concurrency cancels obsolete runs after a new push.
- No persistent cache is enabled by default. For a small package, cache restore/save overhead can cost more than a clean install and fork PRs can read base-branch caches.

Calldiff parses supported source files in both snapshots and may install language grammars on first use. Add `paths` when whole-repository analysis is too slow, with the cross-path tradeoff described above.

Because this is a composite action, selecting Node 24 updates `PATH` for later steps in the same job. If a later step needs a different Node version, run `actions/setup-node` again before that step.

Self-hosted runners must support Node 24 actions (GitHub Actions Runner `v2.327.1` or newer), and need Git, npm registry access, and Bash.

## Development and releases

```bash
npm ci
npm run check
```

The stable `v1` release line includes Marketplace metadata and branding, immutable pins for its own action dependencies, unit tests, a local-action integration check, daily calldiff update monitoring, and Dependabot configuration. See [CHANGELOG.md](CHANGELOG.md) for release notes and [RELEASING.md](RELEASING.md) for the release process and Marketplace checklist.

## License

[MIT](LICENSE)
