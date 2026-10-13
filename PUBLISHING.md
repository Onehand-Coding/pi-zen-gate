# Publishing

## First release

The package name is `pi-zen-gate`. It was not listed on npm when checked on
2026-10-13; availability is not reserved until publication.

Repository, homepage, and issue links point to
https://github.com/Onehand-Coding/pi-zen-gate. Keep `pi.extensions` and the
`pi-package` keyword:
[Pi's gallery](https://pi.dev/docs/latest/packages) discovers npm packages by
that keyword. No compiled build is needed; Pi loads the shipped TypeScript.

From the repository root:

```sh
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

The tarball should contain only `package.json`, `src/index.ts`,
`src/provider.ts`, `src/host-link.ts`, `README.md`, `CHANGELOG.md`, and
`LICENSE`. Tests, CI, node_modules, and local settings are excluded.

### Keep host dependencies peer-only

`@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` are declared in
`peerDependencies` with `"*"`, and `dependencies` is empty. **Do not "fix" this
by adding a real dependency.**

> Upstream's own publishing notes said the opposite: that `pi-ai` should be a
> real dependency because Pi installs extensions with `--legacy-peer-deps`, which
> never auto-installs peers. That reasoning was tested on 2026-10-13 and it does
> not hold. A fresh `pi install git:github.com/Onehand-Coding/pi-zen-gate`
> produced no `node_modules` at all and worked fine, because Pi's host-module
> mapping resolves the deep `pi-ai` subpaths for packages Pi installs itself.
> Declaring a real dependency makes Pi warn on every startup, since it treats
> `pi-ai` as host-provided. Upstream issue #3 reports this and is unanswered.

Commit and push the reviewed release, then authenticate with the npm account
that will own the package and publish:

```sh
npm login
npm publish --access public
```

`prepublishOnly` runs the verification checks again. CI only verifies changes;
it does not publish. After publication, verify a clean Pi installation with:

```sh
pi install npm:pi-zen-gate
```

Select **OpenCode Zen Free** in `/model`. Allow time for the Pi gallery to index
the npm package.

The version does not track upstream's. Upstream is a reference, not a base:
fetch it and cherry-pick anything useful, but never revert a local fix to match
it, and never assume the two share a version number.

## Later releases

Update `CHANGELOG.md`, bump the package version with
`npm version patch --no-git-tag-version` (or `minor` / `major`), and update
`OPENCODE_USER_AGENT` in `src/provider.ts` to the OpenCode version in use. If
re-validating against a newer Pi, bump the pinned `@earendil-works/pi-ai` entry
in `devDependencies` to the new Pi version first. Run verification, review and
commit the release, then push. Each npm version can only be published once, so
verify the tarball before publishing:

```sh
npm pack
# install the tarball into a scratch project and make a live call
npm publish --access public
```

Live verification is optional: `npm run test:live` sends two real free-tier
requests. Regular verification uses fixtures and needs no model credentials.