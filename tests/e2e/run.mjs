// Loads the unpacked extension into real Chrome over CDP and drives it against a local fake Worker.
// Usage: npm run e2e  (CHROME=/path/to/chrome to override the browser)
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8443;
const ORIGIN = `https://localhost:${PORT}`;
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(join(tmpdir(), "alias-e2e-"));

function makeCert() {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-keyout", join(work, "key.pem"), "-out", join(work, "cert.pem"),
  ], { stdio: "ignore" });
  return { key: readFileSync(join(work, "key.pem")), cert: readFileSync(join(work, "cert.pem")) };
}

// A copy of the extension with the fake Worker pre-granted, since a headless run cannot click the permission prompt.
function stageExtension() {
  const dir = join(work, "extension");
  cpSync(join(repo, "extension"), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  manifest.host_permissions = [`${ORIGIN}/*`];
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>signup</title>
<form style="margin:40px"><label>メールアドレス <input id="email" name="email" style="width:320px;height:28px"></label>
<input id="user" name="username"></form>
<script>window.inputEvents = 0; email.addEventListener("input", () => window.inputEvents++);</script>`;

function startWorker(tls) {
  const mailboxes = [];
  const server = createServer(tls, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const authorized = req.headers["cf-access-client-id"] === "id.access" && req.headers["cf-access-client-secret"] === "secret";
      const send = (status, data, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(type === "application/json" ? JSON.stringify(data) : data);
      };
      if (req.url === "/page.html") return send(200, PAGE, "text/html; charset=utf-8");
      if (!authorized) return send(302, "", "text/plain");
      if (req.method === "GET" && req.url === "/api/v1/config") return send(200, { domains: ["4zk.net"], emailAddresses: [] });
      if (req.method === "POST" && req.url === "/api/v1/mailboxes") {
        const { email, name } = JSON.parse(body);
        mailboxes.push({ email, name, cookie: req.headers.cookie });
        return send(201, { id: email, email, name, settings: {} });
      }
      send(404, { error: "Not found" });
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve({ server, mailboxes })));
}

function launchChrome() {
  const proc = spawn(CHROME, [
    "--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
    "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(work, "profile")}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let nextId = 0;
  let buffer = "";
  const pending = new Map();
  const waiters = [];
  proc.stdio[4].on("data", (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else {
        for (const w of [...waiters]) if (w.match(msg)) waiters.splice(waiters.indexOf(w), 1) && w.resolve(msg);
      }
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      proc.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  const waitFor = (match) => new Promise((resolve) => waiters.push({ match, resolve }));
  return { proc, send, waitFor };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, label, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`);
    await sleep(100);
  }
}

async function main() {
  const tls = makeCert();
  const { server, mailboxes } = await startWorker(tls);
  const chrome = launchChrome();
  const { send } = chrome;
  try {
    const { id: extensionId } = await send("Extensions.loadUnpacked", { path: stageExtension() });
    console.log("loaded extension", extensionId);

    async function open(url) {
      const { targetId } = await send("Target.createTarget", { url });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const evaluate = async (expression, userGesture = false) => {
        const { result, exceptionDetails } = await send(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true, userGesture },
          sessionId,
        );
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        return result.value;
      };
      await poll(() => evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === "complete"`), `load ${url}`);
      return { sessionId, evaluate };
    }

    const options = await open(`chrome-extension://${extensionId}/options.html`);
    assert.equal(await options.evaluate("document.getElementById('domain').value"), "4zk.net", "domain defaults to 4zk.net");

    await options.evaluate(`(() => {
      const set = (id, v) => (document.getElementById(id).value = v);
      set("workerUrl", "http://localhost:${PORT}"); set("clientId", ""); set("clientSecret", "secret");
      document.getElementById("settings-form").requestSubmit();
    })()`, true);
    await sleep(200);
    const errors = await options.evaluate(
      `["workerUrl","clientId"].map((f) => document.getElementById(f + "-error").textContent)`,
    );
    assert.ok(errors.every(Boolean), `per-field errors shown: ${errors}`);

    await options.evaluate(`(() => {
      const set = (id, v) => (document.getElementById(id).value = v);
      set("workerUrl", "${ORIGIN}/"); set("clientId", " id.access "); set("clientSecret", "secret"); set("domain", "@4ZK.net");
      document.getElementById("settings-form").requestSubmit();
    })()`, true);
    const saved = await poll(
      () => options.evaluate("chrome.storage.local.get('settings').then((i) => i.settings)"),
      "settings saved",
    );
    assert.deepEqual(saved, { workerUrl: ORIGIN, clientId: "id.access", clientSecret: "secret", domain: "4zk.net" });
    console.log("options: validation errors shown, normalized settings saved");

    await options.evaluate("document.getElementById('test-button').click()", true);
    const testStatus = await poll(async () => {
      const text = await options.evaluate("document.getElementById('settings-status').textContent");
      return text.startsWith("接続できました") && text;
    }, "connection test");
    console.log("options: connection test ->", JSON.stringify(testStatus));

    await options.evaluate(`(() => {
      document.getElementById("clientSecret").value = "wrong";
      document.getElementById("test-button").click();
    })()`, true);
    const deniedStatus = await poll(async () => {
      const text = await options.evaluate("document.getElementById('settings-status').textContent");
      return text.startsWith("認証に失敗") && text;
    }, "redirect reported as unauthorized");
    await options.evaluate(`document.getElementById("clientSecret").value = "secret"`);
    console.log("options: wrong secret (302 from Access) ->", JSON.stringify(deniedStatus));

    const page = await open(`${ORIGIN}/page.html`);
    await page.evaluate("document.getElementById('user').focus()");
    await sleep(300);
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true }, page.sessionId);
    const hasHost = JSON.stringify(root).includes("agentic-alias-inbox");
    assert.equal(hasHost, false, "no button for a non-email field");

    await page.evaluate("document.getElementById('email').focus()");
    const findNode = async (predicate) => {
      const { root } = await send("DOM.getDocument", { depth: -1, pierce: true }, page.sessionId);
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (predicate(node)) return node;
        stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : []));
      }
      return undefined;
    };
    const textOf = (node) => node.children?.find((c) => c.nodeType === 3)?.nodeValue;
    const classOf = (node) => {
      const attrs = node.attributes ?? [];
      return attrs[attrs.indexOf("class") + 1];
    };
    const click = async (node) => {
      const { model } = await send("DOM.getBoxModel", { backendNodeId: node.backendNodeId }, page.sessionId);
      const [x1, y1, , , x3, y3] = model.content;
      const x = (x1 + x3) / 2;
      const y = (y1 + y3) / 2;
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, page.sessionId);
      }
    };

    const trigger = await poll(() => findNode((n) => n.nodeName === "BUTTON" && classOf(n) === "trigger"), "trigger button");
    const triggerBox = (await send("DOM.getBoxModel", { backendNodeId: trigger.backendNodeId }, page.sessionId)).model.content;
    const inputBox = (await send("DOM.getBoxModel", { backendNodeId: (await findNode((n) => n.attributes?.includes("email") && n.nodeName === "INPUT")).backendNodeId }, page.sessionId)).model.content;
    assert.ok(triggerBox[2] <= inputBox[2] && triggerBox[2] > inputBox[2] - 10, "button sits at the input's right edge");
    console.log("page: button shown inside the email field's right edge");

    await click(trigger);
    const generate = await poll(() => findNode((n) => n.nodeName === "BUTTON" && textOf(n) === "新しいアドレスを生成"), "menu");
    await click(generate);
    const value = await poll(async () => {
      const v = await page.evaluate("document.getElementById('email').value");
      return v && v;
    }, "field filled");
    assert.match(value, /^[a-z0-9]{10}@4zk\.net$/);
    assert.equal(await page.evaluate("document.activeElement.id"), "email", "focus stayed on the input");
    assert.ok((await page.evaluate("window.inputEvents")) >= 1, "page saw an input event");
    assert.equal(mailboxes.length, 1);
    assert.deepEqual(mailboxes[0], { email: value, name: value.split("@")[0], cookie: undefined });
    console.log("page: filled", value, "after mailbox creation; name = local part; no cookies sent");

    await click(trigger);
    const existing = await poll(() => findNode((n) => n.nodeName === "BUTTON" && textOf(n) === value), "existing alias in menu");
    assert.ok(existing);
    console.log("page: menu lists the existing alias for this site");

    const rows = await poll(async () => {
      const r = await options.evaluate(
        "[...document.querySelectorAll('#alias-rows tr')].map((tr) => [...tr.cells].slice(0, 2).map((c) => c.textContent))",
      );
      return r.length && r;
    }, "options alias table");
    assert.deepEqual(rows, [[value, "localhost"]]);
    console.log("options: alias table shows", JSON.stringify(rows));
    console.log("E2E PASS");
  } finally {
    chrome.proc.kill();
    server.close();
    await sleep(300);
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("E2E FAIL", error);
  process.exit(1);
});
