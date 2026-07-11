# Publishing

This package is published from `packages/datastar-kit`.

## Versioning

`datastar-kit` starts at `0.1.0` while the public API settles.

- Use patch versions, for example `0.1.1`, for bug fixes, documentation fixes, and packaging-only changes.
- Use minor versions, for example `0.2.0`, for new APIs or breaking API changes while the package is still pre-1.0.
- Move to `1.0.0` once the import surface and runtime behavior are stable enough to support normal SemVer compatibility.

Update the version with one of:

```sh
pnpm --dir packages/datastar-kit version patch --no-git-tag-version
pnpm --dir packages/datastar-kit version minor --no-git-tag-version
pnpm --dir packages/datastar-kit version major --no-git-tag-version
```

During development, collect changes under `CHANGELOG.md`'s `Unreleased` section. During release, rename that section to the exact version and date.

## Release Checklist

1. Confirm the git worktree only contains intended release changes.
2. Confirm `packages/datastar-kit/package.json` has the intended version.
3. Run the release dry run:

```sh
pnpm --filter datastar-kit release:dry-run
```

4. Confirm the package name is available or that you own it:

```sh
npm view datastar-kit version
```

If npm returns a 404, the name is available. If it returns a version, compare it with `package.json` and publish a higher version.

5. Log in to npm:

```sh
npm login
npm whoami
```

6. Publish:

```sh
pnpm --filter datastar-kit publish --tag latest
```

Use `--tag beta` instead of `--tag latest` if you want a softer prerelease-style launch while keeping the `0.x` version.

7. After a successful publish, create a matching git commit and simple version tag:

```sh
git tag -a v0.1.0 -m "datastar-kit v0.1.0"
git push origin HEAD
git push origin v0.1.0
```
