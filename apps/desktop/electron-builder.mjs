import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default {
  appId: "io.github.xavierloeraflores.banger",
  productName: "Banger",
  executableName: "banger",
  // Use the installed, lockfile-pinned Electron, not a floating manifest range.
  electronVersion: require("electron/package.json").version,
  directories: { app: ".packaging/app", output: "release", buildResources: "build" },
  // Dependencies are bundled. Prevent builder's monorepo fallback from adding
  // the source workspace's node_modules a second time.
  files: ["dist/**/*", "package.json", "!node_modules{,/**/*}"],
  asar: true,
  npmRebuild: false,
  artifactName: "Banger-${version}-${os}-${arch}.${ext}",
  // The release job publishes only after every platform passes its smoke check.
  publish: null,
  mac: {
    executableName: "Banger",
    // Apple Silicon needs a valid local signature even without a Developer ID.
    identity: process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_IDENTITY_AUTO_DISCOVERY === "true" ? undefined : "-",
    target: ["dmg", "zip"],
    category: "public.app-category.music",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
  dmg: { sign: false },
  win: { target: ["nsis"] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    artifactName: "Banger-${version}-win-${arch}-setup.${ext}",
  },
  linux: { target: ["AppImage"], category: "AudioVideo", synopsis: "Banger music studio" },
};
