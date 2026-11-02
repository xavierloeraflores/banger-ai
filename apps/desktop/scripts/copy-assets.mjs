import { copyFile } from "node:fs/promises";
import { URL } from "node:url";

await copyFile(new URL("../src/index.html", import.meta.url), new URL("../dist/index.html", import.meta.url));
