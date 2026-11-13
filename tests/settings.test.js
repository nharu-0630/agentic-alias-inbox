import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSettings } from "../extension/lib/settings.js";

const valid = {
  workerUrl: "  https://inbox.4zk.net/some/path/?q=1  ",
  clientId: " abc.access ",
  clientSecret: " s3cret ",
  domain: " @4ZK.Net ",
};

test("normalizes a valid form", () => {
  assert.deepEqual(parseSettings(valid), {
    ok: true,
    settings: { workerUrl: "https://inbox.4zk.net", clientId: "abc.access", clientSecret: "s3cret", domain: "4zk.net" },
  });
});

test("strips a bare trailing slash", () => {
  const result = parseSettings({ ...valid, workerUrl: "https://inbox.4zk.net/" });
  assert.equal(result.settings.workerUrl, "https://inbox.4zk.net");
});

for (const [label, workerUrl] of [
  ["http", "http://inbox.4zk.net"],
  ["garbage", "not a url"],
  ["other scheme", "ftp://inbox.4zk.net"],
]) {
  test(`rejects ${label} worker URL`, () => {
    const result = parseSettings({ ...valid, workerUrl });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors), ["workerUrl"]);
  });
}

test("rejects a malformed domain", () => {
  const result = parseSettings({ ...valid, domain: "foo@bar" });
  assert.deepEqual(Object.keys(result.errors), ["domain"]);
});

test("reports every missing field", () => {
  const result = parseSettings({ clientId: "   " });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["clientId", "clientSecret", "domain", "workerUrl"]);
  assert.equal(parseSettings(undefined).ok, false);
});
