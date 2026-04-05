# Changesets

This directory holds proposed version bumps. Workflow:

1. **When you make a user-visible change** — run `pnpm changeset` and
   describe what changed. Commit the generated `.md` file alongside
   your code.
2. **When ready to release** — maintainer runs `pnpm changeset version`
   to consume all pending changesets, bump the version in
   `package.json`, and rewrite `CHANGELOG.md`. Then
   `pnpm changeset publish` tags and publishes.

In CI, the Release workflow does this automatically on pushes to
`main`: if pending changesets exist, it opens a "Version Packages"
PR. Merge that PR → it publishes the new version.

See https://github.com/changesets/changesets for details.
