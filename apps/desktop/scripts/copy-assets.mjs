import { access, cp, rm } from "node:fs/promises";
const source = new URL("../../www/out/", import.meta.url);
await access(new URL("index.html", source));
const destination = new URL("../dist/web/", import.meta.url);
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
