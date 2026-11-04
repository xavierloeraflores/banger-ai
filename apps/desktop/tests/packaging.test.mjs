import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseVersion } from "../scripts/package.mjs";

test("release tags must match the desktop version without mutating manifests", () => {
  assert.equal(releaseVersion("1.2.3", "v1.2.3"), "1.2.3");
  assert.equal(releaseVersion("1.2.3-rc.1", "v1.2.3-rc.1"), "1.2.3-rc.1");
  assert.equal(releaseVersion("0.1.0"), "0.1.0");
  for (const tag of ["v1.2.4", "1.2.3", "v1.2.3/other", ""]) {
    assert.throws(() => releaseVersion("1.2.3", tag), /must match/);
  }
  for (const version of ["01.2.3", "1.2", "1.2.3+build", "1.2.3-01", "1.2.3-", "../1.2.3"]) {
    assert.throws(() => releaseVersion(version), /Invalid/);
  }
});
