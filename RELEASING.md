# Releasing

The action wrapper and the calldiff CLI have separate versions. A calldiff update normally changes only the exact development dependency, tests, and release notes; wrapper behavior follows this repository's own semantic version.

`v1.0.0` is the first stable release. The movable `v1` tag follows the newest backwards-compatible v1 release, while exact version tags never move.

## Update the tested calldiff version

Dependabot checks npm daily. To update manually:

```bash
npm install --prefix runtime --save-exact calldiff@latest
npm run check
```

Review the published package, its integrity and lockfile diff, its CLI help, and the changed-tree integration result before merging. This lock is the trust gate for comment-capable runs. Calldiff's repository `main` can be ahead of npm, so npm is the release source of truth.

## Publish an action release

1. Make sure CI passes on `main` and the daily `latest` canary is green.
2. Update this package's wrapper version using semantic versioning, update both exact self-references in `.github/workflows/calldiff.yml` to that same version, and document user-visible changes. The self-references must never use the movable major tag.
3. Create and push an exact signed tag such as `v1.0.0`.
4. Create a GitHub Release from that exact tag and publish the release notes from `CHANGELOG.md`. For Marketplace publication, accept the GitHub Marketplace Developer Agreement and select **Publish this Action to the GitHub Marketplace**.
5. Move the matching major tag only after the exact release is public and verified:

   ```bash
   git tag -f v1 v1.0.0
   git push origin v1 --force
   ```

Exact release tags must never move. Consumers can use `@v1` for compatible updates or an exact tag/commit SHA for immutability.

## Marketplace checklist

- Keep exactly one action metadata file at the repository root.
- Keep `name`, `description`, `author`, inputs, outputs, and `branding` in `action.yml` current.
- Keep the repository public and enable two-factor authentication for the publisher.
- Verify the README examples, minimum permissions, fork behavior, and version pinning advice.
- Publish a GitHub Release and select the Marketplace checkbox when listing or updating the action.
- After publishing, test the README quick start from a separate repository before moving the major tag.

GitHub's current publishing instructions are at [Publishing actions in GitHub Marketplace](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).
