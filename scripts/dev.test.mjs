import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { findAvailablePort } from "./dev.mjs";

test("dev skips an occupied port without stopping its listener", async () => {
  const occupied = createServer((socket) => socket.end());
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  try {
    const port = occupied.address().port;
    const selected = await findAvailablePort(port);
    assert.ok(selected > port);
    assert.equal(occupied.listening, true);
    assert.equal(await findAvailablePort(selected), selected);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("dev rejects invalid port settings", async () => {
  for (const port of [0, -1, 65536, NaN, 3000.5]) {
    await assert.rejects(findAvailablePort(port), /PORT must be an integer/);
  }
});

test("development commands start one web server without production app builds", async () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const api = JSON.parse(readFileSync(new URL("apps/api/package.json", root), "utf8"));
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  try {
    for (const [command, expected] of [
      ["dev", ["@banger/api#dev", "@banger/desktop#dev"]],
      ["dev:www", ["@banger/api#dev"]],
      ["dev:desktop", ["@banger/desktop#dev", "@banger/www#dev"]],
    ]) {
      const output = execFileSync(process.execPath, [...manifest.scripts[command].split(" ").slice(1), "--dry=json"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production", PORT: String(occupied.address().port), BANGER_WEB_USER: "dev-test" },
      });
      const plan = JSON.parse(output.slice(output.indexOf("{")));
      assert.deepEqual(plan.tasks.filter((task) => task.task === "dev").map((task) => task.taskId).sort(), expected);
      assert.ok(!plan.tasks.some((task) => task.taskId === "@banger/www#build" || task.taskId === "@banger/api#build"));
      const developmentHash = createHash("sha256").update("development").digest("hex");
      assert.ok(plan.globalCacheInputs.environmentVariables.configured.includes(`NODE_ENV=${developmentHash}`));
      const url = output.match(/Banger development URL: (.+)/)[1];
      assert.ok(Number(new URL(url).port) > occupied.address().port);
      assert.equal(occupied.listening, true);
      for (const task of plan.tasks.filter((task) => task.task === "dev")) {
        assert.equal(task.resolvedTaskDefinition.persistent, true);
        assert.equal(task.resolvedTaskDefinition.cache, false);
        assert.ok(task.environmentVariables.passthrough.some((value) => value.startsWith("PORT=")));
        assert.ok(task.environmentVariables.passthrough.some((value) => value.startsWith("BANGER_DEV_URL=")));
      }
      if (expected.includes("@banger/api#dev")) {
        const apiTask = plan.tasks.find((task) => task.taskId === "@banger/api#dev");
        assert.ok(apiTask.environmentVariables.passthrough.some((value) => value.startsWith("BANGER_WEB_USER=")));
        for (const dependency of Object.keys(api.dependencies).filter((name) => name.startsWith("@banger/") && name !== "@banger/www")) {
          assert.ok(plan.tasks.some((task) => task.taskId === `${dependency}#build`), `Build ${dependency} before API development`);
        }
      }
    }
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
