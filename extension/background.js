import { createAlias } from "./lib/aliases.js";
import { configWarnings, createApiClient, failure } from "./lib/api.js";
import { parseSettings, SETTINGS_KEY } from "./lib/settings.js";
import { siteOf } from "./lib/site.js";
import { createAliasStore } from "./lib/store.js";

const CONTEXT_MENU_ID = "create-masked-email";

// The service worker is the only writer of the alias map, so its in-process queue is enough to serialize writes.
const store = createAliasStore(chrome.storage.local);

async function connect(rawSettings) {
  const parsed = parseSettings(rawSettings);
  if (!parsed.ok) return failure("not-configured");
  const { settings } = parsed;
  const granted = await chrome.permissions.contains({ origins: [`${settings.workerUrl}/*`] });
  if (!granted) return failure("not-configured", undefined, "Worker へのアクセスが許可されていません");
  return { ok: true, settings, api: createApiClient(settings) };
}

async function storedSettings() {
  const items = await chrome.storage.local.get(SETTINGS_KEY);
  return items[SETTINGS_KEY];
}

async function createAliasFor(url) {
  const connection = await connect(await storedSettings());
  if (!connection.ok) return connection;
  return createAlias({ settings: connection.settings, api: connection.api, store, url });
}

// `extensionOnly` handlers expose every alias or call the Worker with caller-supplied settings, so content scripts may not use them.
const handlers = {
  createAlias: { run: ({ url }) => createAliasFor(url) },
  listAliasesForSite: { run: async ({ url }) => ({ ok: true, aliases: await store.listBySite(siteOf(url)) }) },
  openOptions: {
    run: async () => {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    },
  },
  listAliases: { extensionOnly: true, run: async () => ({ ok: true, aliases: await store.list() }) },
  removeAlias: {
    extensionOnly: true,
    run: async ({ email }) => {
      await store.remove(email);
      return { ok: true };
    },
  },
  updateNote: { extensionOnly: true, run: async ({ email, note }) => ({ ok: await store.updateNote(email, note) }) },
  testConnection: {
    extensionOnly: true,
    run: async ({ settings }) => {
      const connection = await connect(settings);
      if (!connection.ok) return connection;
      const result = await connection.api.getConfig();
      if (!result.ok) return result;
      return { ok: true, config: result.config, warnings: configWarnings(result.config, connection.settings.domain) };
    },
  },
};

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler || (handler.extensionOnly && !isExtensionPage(sender))) return false;
  handler
    .run(message, sender)
    .then(sendResponse, (error) => sendResponse(failure("server", undefined, String(error?.message ?? error))));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: "マスクメールを生成して入力", contexts: ["editable"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined) return;
  const result = await createAliasFor(info.pageUrl ?? info.frameUrl);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "aliasResult", result }, { frameId: info.frameId ?? 0 });
  } catch {
    // No content script in that frame (e.g. a restricted page). The alias, if created, is still listed in options.
    const title = result.ok ? `${result.email} を作成しました (入力できませんでした)` : result.message;
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title });
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
