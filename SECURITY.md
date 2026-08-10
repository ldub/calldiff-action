# Security policy

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include tokens, private source code, or exploit details in a public issue.

The action requests no permissions itself. Consumers should grant only:

```yaml
permissions:
  contents: read
  pull-requests: write
```

The action installs `calldiff` from npm and parses source from the checked-out Git trees. Direct comment-capable runs are restricted to this action release's reviewed `runtime/package-lock.json`. Unlocked exact versions and dist-tags such as `latest` require `comment: false`; the token-bearing step is skipped entirely. This matters because adjacent steps on one runner are not an operating-system security boundary: code in an earlier step can persist or modify files used by a later step.

The locked core dependency graph improves reviewability and repeatability, but calldiff's on-demand language grammars are not currently pinned upstream. npm and calldiff receive an allowlisted child-process environment without the comment token. The one-job path therefore trusts the wrapper, locked runtime, any grammar loaded for the analyzed repository, and runner.

For a fresh-runner boundary, call `.github/workflows/calldiff.yml`. Its analysis job receives only `contents: read`, transfers the capped comment as a one-day artifact, and a separate comment job receives `pull-requests: write`. This also permits `calldiff-version: latest` without placing that package on the token-bearing runner.

Pull requests from forks and Dependabot run with a read-only token. A detected read-only 403 is non-fatal and leaves the result in the job summary; unexpected comment failures fail by default. The action never recommends executing fork code under `pull_request_target`.
