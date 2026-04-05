<!--
Thanks for contributing! Keeping PRs small and focused makes review easy.
-->

## Summary

<!-- One paragraph: what this PR does and why. -->

## Changes

<!-- Bullet list of notable changes. -->
-
-

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Documentation only
- [ ] Internal refactor / chore

## Checklist

- [ ] `pnpm lint` passes (`tsc --noEmit` + eslint)
- [ ] `pnpm test` passes (all 170+ unit tests)
- [ ] New behavior is covered by tests
- [ ] I've added a changeset (`pnpm changeset`) — or this PR is doc/internal-only
- [ ] If this touches `src/cli/`, I've manually run `clashcode` once to confirm
- [ ] If this changes public API, I've updated `src/index.ts` exports and JSDoc
- [ ] If this changes config schema, I've bumped `CURRENT_CONFIG_VERSION` and added migration

## Breaking changes

<!-- If checked above: describe the break and the migration path. -->

## Related issues

<!-- "Closes #123" or "Refs #123" -->
