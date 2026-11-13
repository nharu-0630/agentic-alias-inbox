import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { jsonResponse, memoryArea } from "./helpers.js";

const EXTENSION_ORIGIN = "chrome-extension://testid/";
const area = memoryArea();
const granted = new Set();
const listeners = {};
const sentToTabs = [];
const badges = [];
let fetchCalls = [];
let tabSendFails = false;

const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

globalThis.chrome = {
  storage: { local: area },
  permissions: { contains: async ({ origins }) => origins.every((o) => granted.has(o)) },
  runtime: {
    id: "testid",
    getURL: (path) => EXTENSION_ORIGIN + path,
    openOptionsPage: async () => {},
    onMessage: event("message"),
    onInstalled: event("installed"),
  },
  contextMenus: { create: () => {}, onClicked: event("contextMenu") },
  tabs: {
    sendMessage: async (tabId, message, options) => {
      if (tabSendFails) throw new Error("Could not establish connection");
      sentToTabs.push({ tabId, message, options });
    },
  },
  action: {
    setBadgeText: async (details) => badges.push(details),
    setTitle: async () => {},
    onClicked: event("action"),
  },
};

await import("../extension/background.js");

const contentSender = { id: "testid", url: "https://www.shop.example/signup", tab: { id: 7 } };
const extensionSender = { id: "testid", url: `${EXTENSION_ORIGIN}options.html` };
const settings = { workerUrl: "https://inbox.4zk.net", clientId: "id.access", clientSecret: "secret", domain: "4zk.net" };

function dispatch(message, sender = contentSender) {
  return new Promise((resolve) => {
    const async = listeners.message(message, sender, resolve);
    if (!async) resolve(undefined);
  });
}

function serve(respond) {
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return respond(url, init);
  };
}

beforeEach(() => {
  for (const key of Object.keys(area.data)) delete area.data[key];
  granted.clear();
  fetchCalls = [];
  sentToTabs.length = 0;
  badges.length = 0;
  tabSendFails = false;
  serve((url, init) => jsonResponse(201, { ...JSON.parse(init.body), id: "x", settings: {} }));
});

function configure() {
  area.data.settings = settings;
  granted.add("https://inbox.4zk.net/*");
}

test("createAlias without settings asks to configure and sends nothing", async () => {
  const result = await dispatch({ type: "createAlias", url: "https://shop.example/" });
  assert.equal(result.kind, "not-configured");
  assert.equal(fetchCalls.length, 0);
});

test("createAlias without host permission asks to configure", async () => {
  area.data.settings = settings;
  const result = await dispatch({ type: "createAlias", url: "https://shop.example/" });
  assert.equal(result.kind, "not-configured");
  assert.equal(fetchCalls.length, 0);
});

test("createAlias creates the mailbox and lists it for the site", async () => {
  configure();
  const result = await dispatch({ type: "createAlias", url: "https://www.shop.example/signup?x=1" });
  assert.equal(result.ok, true);
  assert.match(result.email, /^[a-z0-9]{10}@4zk\.net$/);
  assert.equal(fetchCalls[0].url, "https://inbox.4zk.net/api/v1/mailboxes");
  assert.equal(JSON.parse(fetchCalls[0].init.body).email, result.email);

  const listed = await dispatch({ type: "listAliasesForSite", url: "https://shop.example/login" });
  assert.deepEqual(listed.aliases.map((a) => a.email), [result.email]);
  const elsewhere = await dispatch({ type: "listAliasesForSite", url: "https://other.example/" });
  assert.deepEqual(elsewhere.aliases, []);
});

test("content scripts cannot call extension-only handlers", async () => {
  configure();
  await dispatch({ type: "createAlias", url: "https://shop.example/" });
  assert.equal(await dispatch({ type: "listAliases" }, contentSender), undefined);
  assert.equal(await dispatch({ type: "testConnection", settings }, contentSender), undefined);
  const fromOptions = await dispatch({ type: "listAliases" }, extensionSender);
  assert.equal(fromOptions.aliases.length, 1);
});

test("options can edit notes and remove records", async () => {
  configure();
  const { email } = await dispatch({ type: "createAlias", url: "https://shop.example/" });
  await dispatch({ type: "updateNote", email, note: "ショップ" }, extensionSender);
  assert.equal((await dispatch({ type: "listAliases" }, extensionSender)).aliases[0].note, "ショップ");
  await dispatch({ type: "removeAlias", email }, extensionSender);
  assert.deepEqual((await dispatch({ type: "listAliases" }, extensionSender)).aliases, []);
});

test("testConnection reports config warnings", async () => {
  granted.add("https://inbox.4zk.net/*");
  serve(() => jsonResponse(200, { domains: ["other.net"], emailAddresses: [] }));
  const result = await dispatch({ type: "testConnection", settings }, extensionSender);
  assert.equal(result.ok, true);
  assert.equal(fetchCalls[0].url, "https://inbox.4zk.net/api/v1/config");
  assert.equal(result.warnings.length, 1);
});

test("unknown message types get no response", async () => {
  assert.equal(await dispatch({ type: "nope" }), undefined);
});

test("context menu creates an alias and sends it to the clicked frame", async () => {
  configure();
  await listeners.contextMenu({ menuItemId: "create-masked-email", pageUrl: "https://shop.example/a", frameId: 3 }, { id: 7 });
  assert.equal(sentToTabs.length, 1);
  assert.deepEqual(sentToTabs[0].options, { frameId: 3 });
  assert.equal(sentToTabs[0].message.type, "aliasResult");
  assert.equal(sentToTabs[0].message.result.ok, true);
  assert.equal((await dispatch({ type: "listAliases" }, extensionSender)).aliases[0].site, "shop.example");
});

test("context menu falls back to a badge when the frame cannot be reached", async () => {
  configure();
  tabSendFails = true;
  await listeners.contextMenu({ menuItemId: "create-masked-email", pageUrl: "https://shop.example/", frameId: 0 }, { id: 7 });
  assert.deepEqual(badges, [{ tabId: 7, text: "!" }]);
  assert.equal((await dispatch({ type: "listAliases" }, extensionSender)).aliases.length, 1);
});
