# Publishing

This package publishes the generated CLI from `bin/clankerlog.js`, but `bin/`
is build output and is not checked into git.

## Release Flow

1. Start clean.

```bash
git status --short
```

2. Bump the version.

```bash
pnpm version minor
```

Use `patch` or `major` instead of `minor` when appropriate.

3. Verify the package.

```bash
pnpm install
mise run check
npm pack --dry-run
```

`npm pack` runs `prepack`, which runs `mise run build` and generates
`bin/clankerlog.js` for the package tarball.

4. Publish with npm.

```bash
npm whoami
npm publish --access public
```

Use `npm publish` for the registry push. `pnpm publish` can fail when pnpm does
not pick up the npm auth session even though `npm publish` works.

5. Push git history and tags.

```bash
git push origin main --follow-tags
```

## Lifecycle Scripts

- `prepack`: builds `bin/clankerlog.js` before `npm pack` and `npm publish`
  assemble the tarball.
- `prepublishOnly`: runs `mise run check` before `npm publish`.
- `postbuild`: makes `bin/clankerlog.js` executable.

## Notes

- Do not commit `bin/`; it is generated output.
- Keep `package.json` `files` pointed at `bin`, `README.md`, and `LICENSE` so
  the published package stays small.
- If `npm publish` fails with auth errors, run `npm login` and then retry
  `npm whoami`.
