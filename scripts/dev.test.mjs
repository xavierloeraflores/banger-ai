import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
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
