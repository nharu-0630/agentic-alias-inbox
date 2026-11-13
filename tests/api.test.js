import { test } from "node:test";
import assert from "node:assert/strict";
import { configWarnings, createApiClient } from "../extension/lib/api.js";
import { jsonResponse } from "./helpers.js";

const settings = { workerUrl: "https://inbox.4zk.net", clientId: "id.access", clientSecret: "secret", domain: "4zk.net" };

function clientReturning(respond) {
  const calls = [];
  const api = createApiClient(settings, async (url, init) => {
    calls.push({ url, init });
    return respond();
  });
  return { api, calls };
}

test("createMailbox sends the exact request", async () => {
  const { api, calls } = clientReturning(() =>
    jsonResponse(201, { id: "x@4zk.net", email: "x@4zk.net", name: "x", settings: {} }),
  );
  const result = await api.createMailbox("x@4zk.net", "x");
  assert.deepEqual(result, { ok: true, mailbox: { id: "x@4zk.net", email: "x@4zk.net", name: "x", settings: {} } });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://inbox.4zk.net/api/v1/mailboxes");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), { email: "x@4zk.net", name: "x" });
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers["CF-Access-Client-Id"], "id.access");
  assert.equal(init.headers["CF-Access-Client-Secret"], "secret");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "manual");
});

const failures = [
  ["409 exists", () => jsonResponse(409, { error: "Mailbox already exists" }), "exists", 409],
  [
    "403 restricted",
    () => jsonResponse(403, { error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }),
    "restricted",
    403,
  ],
  ["403 from the Worker JWT check", () => new Response("Missing required CF Access JWT", { status: 403 }), "unauthorized", 403],
  ["401", () => new Response("", { status: 401 }), "unauthorized", 401],
  ["302 to Access login", () => new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/" } }), "unauthorized", 302],
  ["opaque redirect", () => ({ type: "opaqueredirect", status: 0, json: async () => { throw new Error(); } }), "unauthorized", undefined],
  ["400", () => jsonResponse(400, { error: "Invalid email" }), "bad-request", 400],
  ["500", () => new Response("boom", { status: 500 }), "server", 500],
  ["201 with an unexpected body", () => new Response("<html>", { status: 201 }), "server", 201],
];

for (const [label, respond, kind, status] of failures) {
  test(`createMailbox classifies ${label} as ${kind}`, async () => {
    const { api } = clientReturning(respond);
    const result = await api.createMailbox("x@4zk.net", "x");
    assert.equal(result.ok, false);
    assert.equal(result.kind, kind);
    assert.equal(result.status, status);
    assert.equal(typeof result.message, "string");
  });
}

test("a throwing fetch is a network failure", async () => {
  const api = createApiClient(settings, async () => {
    throw new TypeError("Failed to fetch");
  });
  const result = await api.createMailbox("x@4zk.net", "x");
  assert.equal(result.kind, "network");
  assert.equal(result.ok, false);
});

test("getConfig returns domains and addresses", async () => {
  const { api, calls } = clientReturning(() => jsonResponse(200, { domains: ["4zk.net"], emailAddresses: [] }));
  const result = await api.getConfig();
  assert.deepEqual(result, { ok: true, config: { domains: ["4zk.net"], emailAddresses: [] } });
  assert.equal(calls[0].url, "https://inbox.4zk.net/api/v1/config");
  assert.equal(calls[0].init.headers["CF-Access-Client-Secret"], "secret");
});

test("configWarnings flags a missing domain and a non-empty allowlist", () => {
  assert.deepEqual(configWarnings({ domains: ["4ZK.net"], emailAddresses: [] }, "4zk.net"), []);
  assert.equal(configWarnings({ domains: ["other.net"], emailAddresses: [] }, "4zk.net").length, 1);
  assert.equal(configWarnings({ domains: ["4zk.net"], emailAddresses: ["a@4zk.net"] }, "4zk.net").length, 1);
});
