---
name: fmg-release
description: How to publish a new version of Free Map Genie Cloud (version bump, zips, GitHub release) and the exact release-notes format every release must use. Use whenever the user asks to publish, release, or bump a version.
---

# Publishing a release

Repo: `Vata74/free-map-genie-cloud`. Releases are tagged `vX.Y.Z-cloud`. Only publish when the user asks for it.

## Steps

1. Bump `version` in `package.json` (patch for fixes and small features).
2. Commit it as its own commit: `chore: bump version to X.Y.Z`. **No `Co-Authored-By` or `Claude-Session` trailers, ever** (see the fmg-project skill).
3. Build the zips: `npm run zip:all`. This writes `.output/fmg-X.Y.Z-chrome.zip`, `fmg-X.Y.Z-firefox.zip` and `fmg-X.Y.Z-sources.zip`. Only the chrome and firefox zips are attached.
4. Push: `git push fork nr2bj-base:main` (the local branch is `nr2bj-base`, the fork's branch is `main`). If the CI bot pushed a README status commit in the meantime, run `git pull --rebase --autostash fork main` first.
5. Create the release with the notes below:

```
gh release create vX.Y.Z-cloud --repo Vata74/free-map-genie-cloud --target main \
  --title vX.Y.Z-cloud --notes-file <notes.md> \
  .output/fmg-X.Y.Z-chrome.zip .output/fmg-X.Y.Z-firefox.zip
```

6. Publishing the release starts `.github/workflows/sign-firefox.yml`, which gets the Firefox zip signed by Mozilla (unlisted, self-distributed) and attaches `fmg-X.Y.Z-firefox.xpi` to the same release, usually within a few minutes. Check it with `gh run list --workflow sign-firefox.yml --repo Vata74/free-map-genie-cloud --limit 1`. It needs the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` repository secrets. Mozilla signs each version only once, so a failed release that needs a new zip also needs a new version number. To sign an older release: `gh workflow run sign-firefox.yml --repo Vata74/free-map-genie-cloud -f tag=vX.Y.Z-cloud`.
7. Give the user the release link.

## Release notes format (always exactly this)

Three sections, in this order, with these headings. Plain language written for users of the extension, not for developers: say what they will notice, not how it works inside. No internal file names.

```markdown
## New

- **Short name of the change.** One or two sentences on what it does for the user.

## Fixed since vPREVIOUS-cloud

- **Short name of the fix.** What was wrong and that it works now.

## Downloads

- `fmg-X.Y.Z-chrome.zip` — Chrome, Edge, Brave, and Kiwi Browser (Android). Load unpacked via Developer mode.
- `fmg-X.Y.Z-firefox.xpi` — Firefox, signed by Mozilla. Open it in Firefox to install it permanently.
- `fmg-X.Y.Z-firefox.zip` — Firefox, unsigned. Only loads temporarily via `about:debugging`.
```

The `.xpi` line assumes the signing workflow worked. If it failed, leave the `.xpi` line out until it is attached.

Rules:

- `PREVIOUS` is the tag of the release right before this one (`gh release list --repo Vata74/free-map-genie-cloud --limit 3`).
- If there are no fixes, the "Fixed since" section says: `Nothing else changed — this release is purely <the new thing> on top of vPREVIOUS-cloud.`
- If a release only has fixes, the "New" section says: `Nothing new in this one.`
- When a feature comes from NR2BJ's upstream repo, say so (for example "from NR2BJ's v3.0.12").
