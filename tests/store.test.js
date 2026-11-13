import { test } from "node:test";
import assert from "node:assert/strict";
import { createAliasStore } from "../extension/lib/store.js";
import { memoryArea } from "./helpers.js";

const record = (email, site, createdAt) => ({ email, site, url: `https://${site}/`, createdAt });

test("lists newest first and filters by site", async () => {
  const store = createAliasStore(memoryArea());
  await store.add(record("a@4zk.net", "example.com", "2026-01-01T00:00:00.000Z"));
  await store.add(record("b@4zk.net", "other.org", "2026-02-01T00:00:00.000Z"));
  await store.add(record("c@4zk.net", "example.com", "2026-03-01T00:00:00.000Z"));
  assert.deepEqual((await store.list()).map((r) => r.email), ["c@4zk.net", "b@4zk.net", "a@4zk.net"]);
  assert.deepEqual((await store.listBySite("example.com")).map((r) => r.email), ["c@4zk.net", "a@4zk.net"]);
  assert.deepEqual(await store.listBySite("nowhere.test"), []);
});

test("concurrent adds keep every record", async () => {
  const store = createAliasStore(memoryArea());
  await Promise.all(
    Array.from({ length: 5 }, (_, i) => store.add(record(`${i}@4zk.net`, "example.com", `2026-01-0${i + 1}T00:00:00.000Z`))),
  );
  assert.equal((await store.list()).length, 5);
});

test("remove deletes only that record", async () => {
  const store = createAliasStore(memoryArea());
  await store.add(record("a@4zk.net", "example.com", "2026-01-01T00:00:00.000Z"));
  await store.add(record("b@4zk.net", "example.com", "2026-01-02T00:00:00.000Z"));
  await store.remove("a@4zk.net");
  assert.deepEqual((await store.list()).map((r) => r.email), ["b@4zk.net"]);
});

test("updateNote sets, trims, clears, and ignores unknown addresses", async () => {
  const store = createAliasStore(memoryArea());
  await store.add(record("a@4zk.net", "example.com", "2026-01-01T00:00:00.000Z"));
  assert.equal(await store.updateNote("a@4zk.net", "  shop account "), true);
  assert.equal((await store.list())[0].note, "shop account");
  await store.updateNote("a@4zk.net", "   ");
  assert.equal("note" in (await store.list())[0], false);
  assert.equal(await store.updateNote("missing@4zk.net", "x"), false);
  assert.equal((await store.list()).length, 1);
});

test("persists through the storage area", async () => {
  const area = memoryArea();
  await createAliasStore(area).add(record("a@4zk.net", "example.com", "2026-01-01T00:00:00.000Z"));
  assert.deepEqual((await createAliasStore(area).list()).map((r) => r.email), ["a@4zk.net"]);
});
