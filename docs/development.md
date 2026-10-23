# Development and releases

Use Node.js 22.19 or later and npm. Install with `npm ci --ignore-scripts`. Run `npm test` for the filesystem, evidence, report and CLI checks, and `npm run check` for type checking. Tests use synthetic fixtures and temporary directories.

For direct local development, run `npm run build`, then `node /absolute/path/to/cedar/dist/src/cli.js --help`. Users should follow the versioned Skill instead of building the project.

## Package verification

`npm run test:package` builds Cedar, packs it into a temporary archive, checks the file allowlist, and runs it from an empty consumer directory with a fresh npm cache. It checks version and Skill access, collects a synthetic target, validates a supplied synthetic task map and renders reports. It also checks that the target and consumer directory remain unchanged.

To verify an existing release artifact, run:

```sh
npm run test:package -- /absolute/path/to/package.tgz
```

This check does not call a model or assess generated task quality. Real onboarding needs the host agent to create and review the task map.

## Version preparation

1. Update `package.json`, `package-lock.json`, the Skill's pinned version/asset URL and README versioned links together.
2. Run the tests, type check and package smoke. Inspect the tracked source tree for unintended project inputs, credentials or generated artifacts.
3. Build and pack with `npm pack --ignore-scripts --pack-destination <release-directory>`. Verify that exact tarball with the package smoke, then record its SHA-256 digest.
4. Tag the reviewed source commit and publish the exact tested tarball and checksum as assets in the matching GitHub Release. Early releases should be marked as prereleases. Do not replace a published version's assets; issue a new version for changes.
5. Verify unauthenticated access to the raw versioned Skill and assets, compare the downloaded checksum, and execute the documented remote package command from an empty directory.

The package remains `private: true` to prevent accidental npm registry publication. Distribution uses a GitHub Release tarball; no npm publishing credentials are required.

`.cedar/` is ignored local storage for generated outputs and internal working material. Keep public examples synthetic and avoid committing consumer project snapshots.
