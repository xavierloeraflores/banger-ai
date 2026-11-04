import { copyFile } from "node:fs/promises";
await copyFile(new URL("../src/preload.cjs", import.meta.url), new URL("../dist/preload.cjs", import.meta.url));
await copyFile(new URL("../build/icon.png", import.meta.url), new URL("../dist/icon.png", import.meta.url));
