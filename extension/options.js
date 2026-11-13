import { DEFAULT_DOMAIN, parseSettings, SETTINGS_KEY } from "./lib/settings.js";
import { ALIASES_KEY } from "./lib/store.js";

const FIELDS = ["workerUrl", "clientId", "clientSecret", "domain"];

const form = document.getElementById("settings-form");
const testButton = document.getElementById("test-button");
const settingsStatus = document.getElementById("settings-status");
const rows = document.getElementById("alias-rows");
const filter = document.getElementById("filter");
const count = document.getElementById("alias-count");
const empty = document.getElementById("empty");

let aliases = [];
let renderPending = false;

function setStatus(text, tone = "") {
  settingsStatus.textContent = text;
  settingsStatus.className = `status ${tone}`;
}

async function loadForm() {
  const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
  for (const name of FIELDS) {
    form.elements[name].value = saved?.[name] ?? (name === "domain" ? DEFAULT_DOMAIN : "");
  }
}

function showErrors(errors = {}) {
  for (const name of FIELDS) {
    document.getElementById(`${name}-error`).textContent = errors[name] ?? "";
    form.elements[name].setAttribute("aria-invalid", String(name in errors));
  }
}

// Must run before any other await so the permission prompt still has the click's user gesture.
async function parseAndAuthorize() {
  const parsed = parseSettings(Object.fromEntries(FIELDS.map((name) => [name, form.elements[name].value])));
  showErrors(parsed.ok ? {} : parsed.errors);
  if (!parsed.ok) return undefined;
  const granted = await chrome.permissions.request({ origins: [`${parsed.settings.workerUrl}/*`] });
  if (!granted) {
    setStatus("Worker へのアクセスが許可されませんでした。", "error");
    return undefined;
  }
  return parsed.settings;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = await parseAndAuthorize();
  if (!settings) return;
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await loadForm();
  setStatus("保存しました。", "ok");
});

testButton.addEventListener("click", async () => {
  const settings = await parseAndAuthorize();
  if (!settings) return;
  testButton.disabled = true;
  setStatus("接続中…");
  const result = await chrome.runtime.sendMessage({ type: "testConnection", settings });
  testButton.disabled = false;
  if (!result.ok) return setStatus(result.message, "error");
  const lines = [`接続できました。DOMAINS: ${result.config.domains.join(", ") || "(なし)"}`, ...result.warnings.map((w) => `注意: ${w}`)];
  setStatus(lines.join("\n"), result.warnings.length ? "error" : "ok");
});

function cell(className, ...children) {
  const td = document.createElement("td");
  td.className = className;
  td.append(...children);
  return td;
}

function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function siteLink(alias) {
  if (!/^https?:\/\//.test(alias.url)) return alias.site;
  const a = document.createElement("a");
  a.href = alias.url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = alias.site;
  a.title = alias.url;
  return a;
}

function row(alias) {
  const note = document.createElement("input");
  note.type = "text";
  note.value = alias.note ?? "";
  note.placeholder = "メモ";
  note.setAttribute("aria-label", `${alias.email} のメモ`);
  note.addEventListener("change", () => chrome.runtime.sendMessage({ type: "updateNote", email: alias.email, note: note.value }));

  const copy = button("コピー", async () => {
    await navigator.clipboard.writeText(alias.email);
    copy.textContent = "コピーしました";
    setTimeout(() => (copy.textContent = "コピー"), 1500);
  });
  const remove = button("記録を削除", async () => {
    const message = `${alias.email} の記録を削除しますか？\nサーバー上のメールボックスは削除されず、引き続きメールを受信します。`;
    if (confirm(message)) await chrome.runtime.sendMessage({ type: "removeAlias", email: alias.email });
  });

  const tr = document.createElement("tr");
  tr.append(
    cell("email", alias.email),
    cell("site", siteLink(alias)),
    cell("date", new Date(alias.createdAt).toLocaleString("ja-JP")),
    cell("note", note),
    cell("ops", copy, remove),
  );
  return tr;
}

function render() {
  renderPending = false;
  const query = filter.value.trim().toLowerCase();
  const visible = query
    ? aliases.filter((a) => a.email.includes(query) || a.site.includes(query) || (a.note ?? "").toLowerCase().includes(query))
    : aliases;
  rows.replaceChildren(...visible.map(row));
  count.textContent = query ? `${visible.length} / ${aliases.length} 件` : `${aliases.length} 件`;
  empty.hidden = aliases.length > 0;
}

async function loadAliases() {
  const result = await chrome.runtime.sendMessage({ type: "listAliases" });
  aliases = result.ok ? result.aliases : [];
  // Re-rendering while a note is being edited would drop the caret, so wait until focus leaves the table.
  if (rows.contains(document.activeElement)) renderPending = true;
  else render();
}

rows.addEventListener("focusout", () => {
  if (renderPending) setTimeout(() => !rows.contains(document.activeElement) && render());
});
filter.addEventListener("input", render);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ALIASES_KEY in changes) loadAliases();
});

loadForm();
loadAliases();
