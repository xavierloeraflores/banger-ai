# Desktop distribution

The `Desktop builds` GitHub Actions workflow uses electron-builder to create
installers. It runs manually or when a `v*` tag is pushed. All builds work without
signing secrets. A version-tag build publishes a GitHub Release only after every
platform has built and passed the packaged-app smoke check.

## Platforms

| Platform | CPU | Native CI runner | Downloads |
| --- | --- | --- | --- |
| macOS | Apple Silicon ARM64 | `macos-15` | DMG and ZIP |
| macOS | Intel x64 | `macos-15-intel` | DMG and ZIP |
| Windows | x64 | `windows-2022` | NSIS `.exe` installer |
| Linux | x64 | `ubuntu-22.04` | AppImage |

macOS builds are separate architectures, not a universal binary. Windows ARM64,
Linux ARM64, and 32-bit systems are outside this release matrix. Build and test
on the target OS. Cross-platform installer builds are deliberately rejected by
the local command. macOS can package the other Mac architecture with `--x64` or
`--arm64`, but smoke testing requires a compatible machine. CI builds each one
on its matching CPU.

The bundled Electron version determines minimum OS support. This workflow tests
the runners above, not every older OS. Windows users need a supported 64-bit
Windows desktop. Linux needs a graphical session and Electron's GTK/NSS/audio
libraries. AppImage mounting requires FUSE 2, commonly `libfuse2`; systems without
FUSE can use `./Banger-*.AppImage --appimage-extract` and then
`./squashfs-root/AppRun`. Make the download executable with `chmod +x` first.
Do not disable Chromium's sandbox to work around a distribution's sandbox policy.

Unsigned downloads can trigger macOS Gatekeeper or Windows SmartScreen. Until
signing is configured, users must follow their OS's explicit approval flow for a
trusted download; managed devices may block it. ZIP preserves the Mac app bundle
and executable permissions. GitHub's outer workflow-artifact ZIP contains the
actual DMG/ZIP/installer/AppImage to distribute.
Mac builds without a Developer ID receive an ad-hoc local signature so Apple
Silicon can launch them. This does not establish publisher trust or notarization.

Local Muse models and llama.cpp are downloaded on demand into the user profile,
not shipped in installers. The existing runtime needs `tar` to extract archives;
Windows 10/11 includes it. Model downloads require network access, disk space,
memory, and the runtime's platform requirements. Paid AI services still require
the user's credentials. The hosted API, PostgreSQL, and server secrets are not
part of this desktop distribution. There is no automatic app-update service.

## Build locally

Use Node 24 and the root `packageManager` version, currently pnpm 11.9.0.
Install development dependencies even when the shell sets `NODE_ENV=production`.

```sh
pnpm install --frozen-lockfile --prod=false
pnpm desktop:pack                 # Unpacked app for the current OS/CPU
pnpm desktop:dist                 # Installers for the current OS/CPU
pnpm desktop:dist:mac --arm64      # On macOS ARM64
pnpm desktop:dist:mac --x64        # On macOS Intel
pnpm desktop:dist:win --x64        # On Windows
pnpm desktop:dist:linux --x64      # On Linux
pnpm desktop:smoke                # Launch and verify the current host's unpacked app
```

Each packaging command builds shared workspace libraries, the static Next.js
export, and the TypeScript Electron main process with `NODE_ENV=production`.
It then stages the app in `apps/desktop/.packaging/app`. esbuild bundles the
compiled main process and its JavaScript runtime dependencies, including the
agent, compiler, harness, provider SDKs, and jose. Electron and Node built-ins
remain external. A bundle audit rejects other unresolved package imports.
The SDK's optional text decoder is bundled; WebSocket native acceleration is
disabled in favor of its JavaScript implementation, avoiding platform addons.

The stage contains the main bundle, sandboxed CommonJS preload, full web export,
audio worklet, and a minimal app manifest. electron-builder stores these in
`app.asar`. Asset paths remain relative to `import.meta.url` inside the archive;
`banger://app/` serves the export without a development server or checkout.
The runtime does not rely on pnpm workspace symlinks. `.env` files, source trees,
developer credentials, and development dependencies are excluded. If a future
runtime dependency uses native addons or filesystem assets, extend the staging
step and smoke check before adding it.

Outputs are in `apps/desktop/release`, with names such as
`Banger-0.1.0-mac-arm64.dmg`, `Banger-0.1.0-mac-x64.zip`,
`Banger-0.1.0-win-x64-setup.exe`, and `Banger-0.1.0-linux-x64.AppImage`.
An unpacked application is retained beside them. These directories are ignored
by Git. The stable application ID is `io.github.xavierloeraflores.banger`.
NSIS uses a per-user assisted installation and preserves app data on uninstall.

The smoke command launches the actual executable from a temporary directory
with a fresh user profile and a deliberately invalid development URL. It verifies
the bundled startup screen, JavaScript/CSS assets, sandboxed preload, workspace,
library and model IPC, and AudioWorklet loading. It makes no paid requests or
model downloads. On a headless Linux host, run
`xvfb-run --auto-servernum pnpm desktop:smoke`.
To check a copied or extracted app, pass its absolute executable path after
`pnpm desktop:smoke`. Testing the unpacked app does not verify the NSIS install
wizard or AppImage mounting on every distribution.

## Run CI and download builds

Push the workflow to GitHub, then open **Actions → Desktop builds → Run workflow**
and choose a branch. Manual builds upload artifacts without publishing a release.
The workflow must exist on the default branch before GitHub offers its manual
dispatch control. With GitHub CLI:

```sh
gh workflow run desktop-release.yml --ref main
gh run list --workflow desktop-release.yml
gh run download RUN_ID --dir downloads
```

Each run uses Node 24, the repository-pinned pnpm, a pnpm download cache keyed by
the lockfile, and a frozen-lockfile install. It builds in production mode on each
native runner and launches that runner's unpacked app. Workflow artifacts are
named `Banger-mac-arm64`, `Banger-mac-x64`, `Banger-win-x64`, and
`Banger-linux-x64` and are retained for 30 days. Completed installers are uploaded
even when a later smoke check fails; inspect the run status before using them.

## Publish a version

`apps/desktop/package.json` is the desktop version source. Set it to numeric
SemVer, optionally with a prerelease such as `0.2.0-rc.1`. Build metadata suffixes
are not supported. The tag must match exactly, including its `v` prefix. A
mismatch fails before packaging rather than silently changing the app version.
Manual and local builds use the manifest version without creating tags.

1. Update the desktop version and commit it with the release changes.
2. Run `pnpm test:plan --base main`, then `pnpm test --base main` with a dedicated
   test `DATABASE_URL` if selected. Run the browser/audio release checks in
   [testing.md](testing.md), and package/smoke-test locally.
3. Merge into `main`, push it, and push the matching tag. For the initial version:

   ```sh
   git tag -a v0.1.0 -m "Banger 0.1.0"
   git push origin main
   git push origin v0.1.0
   ```

4. Wait for all four build jobs. The release job gathers their downloads, creates
   a draft with generated notes, uploads the installers, then publishes it.
   Tags containing a prerelease suffix produce a GitHub prerelease. Reruns replace
   assets with the same names, allowing recovery after a failed upload.
5. Download installers from the repository's **Releases** page. These assets
   persist beyond workflow-artifact retention.

Only the release job has `contents: write`; the build jobs have read access.
GitHub's built-in `GITHUB_TOKEN` publishes the release, so no personal token is
required. Repository/organization policy must allow Actions and release writes.
The packaging command always passes `--publish never` to electron-builder, so
local commands cannot accidentally publish.

## Enable signing later

Local packaging and CI disable automatic macOS identity discovery. The current
configuration does not require signing. It includes hardened-runtime entitlements
for Electron's JIT and helpers. Do not commit certificates, private keys, or
passwords. The following uses electron-builder 26's signing configuration.

For macOS, obtain an Apple Developer ID Application certificate, export it with
its private key as a password-protected `.p12`, and configure repository secrets.
Add these variables to the **Build installers** step only for the Mac jobs:

```yaml
env:
  CSC_LINK: ${{ secrets.MAC_CSC_LINK }} # Base64-encoded .p12
  CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

An explicit certificate works with automatic identity discovery disabled.
electron-builder signs the app and uses the Apple credentials to notarize and
staple it. `mac.notarize` is intentionally not disabled. App Store Connect API
keys are an alternative supported by electron-builder. `dmg.sign` is currently
false; enable it if the outer DMG should also be signed. Validate downloaded
signed builds using `codesign --verify --deep --strict`, `spctl --assess --type
execute`, and `xcrun stapler validate`. Once signing is mandatory, enable
`forceCodeSigning` and fail CI on missing signing/notarization credentials.

For Windows, use a trusted code-signing certificate/service. For a certificate
that permits PFX export, map these secrets only on the Windows build step:

```yaml
env:
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }} # Base64-encoded .pfx
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

electron-builder signs the executable and NSIS installer. Hardware-backed
certificates and cloud signing services require their provider's setup; Azure
Trusted Signing uses electron-builder 26's `win.azureSignOptions` plus Azure
credentials. Verify the result with PowerShell `Get-AuthenticodeSignature` and
test installation on a clean Windows machine. Signing alone does not guarantee
immediate SmartScreen reputation.

See the official [macOS signing guide](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/),
[notarization guide](https://www.electron.build/v26/docs/notarization/), and
[Windows signing guide](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).

## Validation recorded on November 4, 2026

On a macOS ARM64 host, production packaging produced the DMG and ZIP. The packaged
app passed its smoke check from the unpacked directory and from the mounted DMG.
The ad-hoc signature, DMG checksum, ZIP integrity, and ASAR contents were checked.
Desktop and HTTP browser smokes passed, as did desktop ESLint, actionlint, and all
eleven selected test suites, including integration tests in a dedicated PostgreSQL
database. Windows x64, Linux x64, and macOS Intel packaging and launch checks
still require their first GitHub Actions run. Developer ID signing, notarization,
Windows signing, and GitHub Release publication were not exercised locally.
