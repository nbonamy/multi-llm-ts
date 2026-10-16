# Publishing to npm

The **Publish to npm** GitHub Actions workflow publishes `multi-llm-ts` manually
from `main`. It uses npm trusted publishing through GitHub OIDC; no npm token,
repository publishing secret, or committed authentication file is required.

## Configure npm trust once

After `.github/workflows/publish.yml` is available on `main`, open the
`multi-llm-ts` package settings on npmjs.com and add a GitHub Actions trusted
publisher with these values:

| Field | Value |
| --- | --- |
| Organization or user | `nbonamy` |
| Repository | `multi-llm-ts` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty |
| Allowed actions | Allow direct publishing with `npm publish` |

This is an npm-side package setting, not a GitHub secret. The workflow cannot
authenticate until this trust relationship exists. Complete the first successful
publication within two days of creating a new trust configuration; otherwise,
recreate the expired configuration before publishing.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup
details. The workflow uses Node 24 on a GitHub-hosted runner and grants
`id-token: write` only to the publishing job. npm generates provenance
automatically for trusted publication from this public repository.

## Prepare and publish a release

1. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` for the release.
   Use a stable version such as `5.1.3`; this workflow does not publish prereleases.
2. Validate locally with `npm ci --ignore-scripts`, `npm run typecheck`,
   `npm run dist`, and `npm pack --dry-run --json --ignore-scripts`.
3. Commit and push the release changes to `main`.
4. In GitHub Actions, select **Publish to npm → Run workflow**, keep the branch
   on `main`, and enter the exact committed package version.

Starting the workflow publishes the package if all checks pass. It validates
the requested version and lockfile version, installs locked dependencies, runs
typechecking, lint, tests, and the build, then previews the package contents.
The content check permits only `dist/`, `package.json`, README, and LICENSE,
and requires the CommonJS, ESM, and TypeScript entry points to exist. Keep
credentials out of source and build inputs as well as the package file list.

After npm publication succeeds, a separate job tags the dispatched commit as
`vVERSION` and creates a GitHub release with generated notes. That job uses
GitHub's temporary workflow token with `contents: write`; no personal access
token is stored. The release uses the commit selected at dispatch even if
`main` advances during the run.

## Retry a failed release

If validation fails, fix the problem before dispatching again. npm package
versions are immutable, so an already published version cannot be overwritten.
Inspect npm before retrying an interrupted publication. If only GitHub release
creation fails, rerun that failed job instead of publishing the package again.

To validate without publication, run the local checks above. The package preview
inside the workflow is a validation step; dispatching the workflow is a real
publication request.
