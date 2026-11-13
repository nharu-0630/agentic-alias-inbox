(async () => {
  // Loaded from the extension so the page and the unit tests share one detection rule.
  const { isEmailField } = await import(chrome.runtime.getURL("lib/field.js"));

  const HIDE_DELAY_MS = 150;
  const BUTTON_SIZE = 22;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, "Hiragino Sans", sans-serif; }
    .trigger {
      position: fixed; width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px; padding: 0;
      border: 1px solid #9aa4b2; border-radius: 6px; background: #fff; color: #1f2937;
      cursor: pointer; font-weight: 700; display: grid; place-items: center;
    }
    .trigger:hover { background: #eef2f7; }
    .menu, .toast {
      position: fixed; min-width: 240px; max-width: 320px; padding: 6px;
      border: 1px solid #c8ced6; border-radius: 8px; background: #fff; color: #1f2937;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    }
    .toast { right: 16px; bottom: 16px; padding: 10px 12px; }
    .item {
      display: block; width: 100%; padding: 6px 8px; border: 0; border-radius: 5px;
      background: none; color: inherit; text-align: left; cursor: pointer;
    }
    .item:hover:not(:disabled) { background: #eef2f7; }
    .item:disabled { opacity: 0.6; cursor: default; }
    .heading { padding: 6px 8px 2px; color: #6b7280; font-size: 11px; }
    .status { padding: 6px 8px; }
    .status.error { color: #b91c1c; }
    .link { padding: 0; border: 0; background: none; color: #2563eb; text-decoration: underline; cursor: pointer; }
    [hidden] { display: none !important; }
    @media (prefers-color-scheme: dark) {
      .trigger, .menu, .toast { background: #1f2937; color: #f3f4f6; border-color: #4b5563; }
      .trigger:hover, .item:hover:not(:disabled) { background: #374151; }
      .heading { color: #9ca3af; }
      .status.error { color: #fca5a5; }
      .link { color: #93c5fd; }
    }
  `;

  let host;
  let ui;
  let current = null;
  let hideTimer;
  let positionFrame;
  let toastTimer;

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function ensureUi() {
    if (host?.isConnected) return;
    host = document.createElement("agentic-alias-inbox");
    const shadow = host.attachShadow({ mode: "closed" });
    ui = {
      trigger: el("button", { className: "trigger", type: "button", title: "マスクメールを生成", textContent: "@" }),
      menu: el("div", { className: "menu", hidden: true }),
      toast: el("div", { className: "toast", hidden: true }),
    };
    shadow.append(el("style", { textContent: STYLE }), ui.trigger, ui.menu, ui.toast);
    // Keeps focus on the page's input so clicking our UI does not blur it.
    host.addEventListener("mousedown", (event) => event.preventDefault());
    ui.trigger.addEventListener("click", () => (ui.menu.hidden ? openMenu() : closeMenu()));
    document.documentElement.append(host);
  }

  function isVisible(input) {
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function position() {
    positionFrame = undefined;
    if (!current?.isConnected || !isVisible(current)) return hide();
    const rect = current.getBoundingClientRect();
    const left = rect.right - BUTTON_SIZE - 4;
    const top = rect.top + (rect.height - BUTTON_SIZE) / 2;
    Object.assign(ui.trigger.style, { left: `${left}px`, top: `${top}px` });
    Object.assign(ui.menu.style, {
      top: `${rect.bottom + 4}px`,
      right: `${Math.max(8, document.documentElement.clientWidth - rect.right)}px`,
    });
  }

  function schedulePosition() {
    if (current && positionFrame === undefined) positionFrame = requestAnimationFrame(position);
  }

  function show(input) {
    clearTimeout(hideTimer);
    ensureUi();
    if (current !== input) closeMenu();
    current = input;
    ui.trigger.hidden = false;
    position();
  }

  function hide() {
    clearTimeout(hideTimer);
    current = null;
    if (!ui) return;
    ui.trigger.hidden = true;
    closeMenu();
  }

  function closeMenu() {
    if (ui) ui.menu.hidden = true;
  }

  async function send(message) {
    try {
      return (await chrome.runtime.sendMessage(message)) ?? { ok: false, kind: "server", message: "拡張機能から応答がありません" };
    } catch {
      return { ok: false, kind: "reload", message: "拡張機能が更新されました。ページを再読み込みしてください" };
    }
  }

  function pageUrl() {
    if (window.top === window) return location.href;
    // The site an alias belongs to is the top-level page, even when the form lives in an iframe.
    const origins = location.ancestorOrigins;
    const top = origins?.[origins.length - 1];
    return top && top !== "null" ? `${top}/` : location.href;
  }

  function fill(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    // The prototype setter bypasses framework-installed value trackers, so React and Vue see the input event.
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function errorNodes(result) {
    const nodes = [result.message];
    if (result.kind === "not-configured") {
      const open = el("button", { className: "link", type: "button", textContent: "設定を開く" });
      open.addEventListener("click", () => send({ type: "openOptions" }));
      nodes.push(" ", open);
    }
    return nodes;
  }

  function setStatus(status, nodes, isError) {
    status.className = isError ? "status error" : "status";
    status.replaceChildren(...nodes);
    status.hidden = nodes.length === 0;
  }

  async function openMenu() {
    const target = current;
    const generate = el("button", { className: "item", type: "button", textContent: "新しいアドレスを生成" });
    const status = el("div", { className: "status", hidden: true });
    const existing = el("div");
    ui.menu.replaceChildren(generate, status, existing);
    ui.menu.hidden = false;
    position();

    generate.addEventListener("click", async () => {
      generate.disabled = true;
      setStatus(status, ["メールボックスを作成中…"], false);
      const result = await send({ type: "createAlias", url: pageUrl() });
      generate.disabled = false;
      if (!result.ok) return setStatus(status, errorNodes(result), true);
      fill(target, result.email);
      closeMenu();
    });

    const listed = await send({ type: "listAliasesForSite", url: pageUrl() });
    if (!listed.ok || listed.aliases.length === 0) return;
    const items = listed.aliases.map((alias) => {
      const item = el("button", { className: "item", type: "button", textContent: alias.email, title: alias.note ?? "" });
      item.addEventListener("click", () => {
        fill(target, alias.email);
        closeMenu();
      });
      return item;
    });
    existing.replaceChildren(el("div", { className: "heading", textContent: "このサイトで作成したアドレス" }), ...items);
  }

  function showToast(nodes, isError) {
    ensureUi();
    clearTimeout(toastTimer);
    setStatus(ui.toast, nodes, isError);
    ui.toast.className = isError ? "toast status error" : "toast";
    toastTimer = setTimeout(() => (ui.toast.hidden = true), isError ? 8000 : 4000);
  }

  function deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function onAliasResult(result) {
    if (!result.ok) return showToast(errorNodes(result), true);
    const target = deepActiveElement();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      fill(target, result.email);
      showToast([`${result.email} を入力しました`], false);
    } else {
      showToast([`${result.email} を作成しました。入力欄が見つからないため設定画面から確認してください`], false);
    }
  }

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.composedPath()[0];
      if (target === host) return;
      if (isEmailField(target) && isVisible(target)) show(target);
      else if (current) hide();
    },
    true,
  );

  document.addEventListener(
    "focusout",
    (event) => {
      if (event.composedPath()[0] !== current) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    },
    true,
  );

  window.addEventListener("scroll", schedulePosition, { capture: true, passive: true });
  window.addEventListener("resize", schedulePosition, { passive: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "aliasResult") return false;
    onAliasResult(message.result);
    sendResponse({ ok: true });
    return false;
  });

  const initial = deepActiveElement();
  if (isEmailField(initial) && isVisible(initial)) show(initial);
})();
