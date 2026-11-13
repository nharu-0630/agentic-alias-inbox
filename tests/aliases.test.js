import { test } from "node:test";
import assert from "node:assert/strict";
import { createAlias } from "../extension/lib/aliases.js";
import { createAliasStore } from "../extension/lib/store.js";
import { memoryArea } from "./helpers.js";

const settings = { workerUrl: "https://inbox.4zk.net", clientId: "id", clientSecret: "s", domain: "4zk.net" };
const now = () => new Date("2026-11-14T00:00:00.000Z");

function sequentialBytes() {
  let next = 0;
  return (n) => Uint8Array.from({ length: n }, () => next++ % 36);
}

function fakeApi(results) {
  const created = [];
  return {
    created,
    async createMailbox(email, name) {
      created.push({ email, name });
      return results.shift();
    },
  };
}

const ok = { ok: true, mailbox: {} };
const exists = { ok: false, kind: "exists", status: 409, message: "exists" };

test("creates the mailbox, then saves a normalized record", async () => {
  const api = fakeApi([ok]);
  const store = createAliasStore(memoryArea());
  const result = await createAlias({
    settings, api, store, now, randomBytes: sequentialBytes(),
    url: "https://www.example.com/signup/step1?ref=abc#top",
  });
  assert.equal(result.ok, true);
  assert.equal(result.email, "abcdefghij@4zk.net");
  assert.deepEqual(api.created, [{ email: "abcdefghij@4zk.net", name: "abcdefghij" }]);
  assert.deepEqual(await store.list(), [
    { email: "abcdefghij@4zk.net", site: "example.com", url: "https://www.example.com/signup/step1", createdAt: "2026-11-14T00:00:00.000Z" },
  ]);
});

test("retries with a new address when the mailbox exists", async () => {
  const api = fakeApi([exists, ok]);
  const store = createAliasStore(memoryArea());
  const result = await createAlias({ settings, api, store, now, randomBytes: sequentialBytes(), url: "https://example.com/" });
  assert.equal(result.ok, true);
  assert.equal(api.created.length, 2);
  assert.notEqual(api.created[0].email, api.created[1].email);
  assert.equal(result.email, api.created[1].email);
  assert.deepEqual((await store.list()).map((r) => r.email), [api.created[1].email]);
});

test("gives up after three existing addresses and saves nothing", async () => {
  const api = fakeApi([exists, exists, exists, ok]);
  const store = createAliasStore(memoryArea());
  const result = await createAlias({ settings, api, store, now, url: "https://example.com/" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "exists");
  assert.equal(api.created.length, 3);
  assert.deepEqual(await store.list(), []);
});

test("returns other failures immediately without saving", async () => {
  const api = fakeApi([{ ok: false, kind: "unauthorized", status: 403, message: "no" }]);
  const store = createAliasStore(memoryArea());
  const result = await createAlias({ settings, api, store, now, url: "https://example.com/" });
  assert.equal(result.kind, "unauthorized");
  assert.equal(api.created.length, 1);
  assert.deepEqual(await store.list(), []);
});

test("never creates a mailbox for an unparseable page URL", async () => {
  const api = fakeApi([ok]);
  const store = createAliasStore(memoryArea());
  const result = await createAlias({ settings, api, store, now, url: "not a url" });
  assert.equal(result.kind, "bad-request");
  assert.deepEqual(api.created, []);
});
