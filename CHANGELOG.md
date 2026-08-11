# Changelog

## v1.0.1 - 2026-08-10

- Adds a product screenshot near the top of the README and Marketplace listing.

## v1.0.0 - 2026-08-10

First stable release of Calldiff PR Comment.

- Runs calldiff for pull request base and head commits and writes the result to the job summary.
- Creates or updates one sticky pull request comment with safe truncation and complete result-file output.
- Provides editable paths, entrypoints, depth, warning, failure, timeout, and version inputs.
- Separates the action release from the tested calldiff version and monitors new calldiff releases daily.
- Includes an optional two-job reusable workflow that isolates analysis from the write-capable comment token.
- Handles fork and Dependabot permission restrictions without hiding unexpected comment failures.
