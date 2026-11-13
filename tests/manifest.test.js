import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "extension");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const read = (path) => readFileSync(join(root, path), "utf8");

function jsFiles(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? jsFiles(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : [],
  );
}

test("background is a module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
});

test("every file the manifest references exists", () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((c) => c.js ?? []),
    ...manifest.web_accessible_resources.flatMap((w) => w.resources),
  ];
  for (const path of referenced) assert.ok(existsSync(join(root, path)), `${path} exists`);
});

test("options.html references existing assets", () => {
  const html = read(manifest.options_ui.page);
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2);
  for (const ref of refs) assert.ok(existsSync(join(root, ref)), `${ref} exists`);
});

test("content script only loads web-accessible extension files", () => {
  const accessible = new Set(manifest.web_accessible_resources.flatMap((w) => w.resources));
  const loaded = [...read("content.js").matchAll(/getURL\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(loaded.length > 0);
  for (const path of loaded) assert.ok(accessible.has(path), `${path} is web accessible`);
});

test("files the content script imports have no imports of their own", () => {
  for (const path of manifest.web_accessible_resources.flatMap((w) => w.resources)) {
    assert.doesNotMatch(read(path), /^import /m, `${path} would need its imports exposed too`);
  }
});

test("every relative import resolves", () => {
  for (const file of jsFiles()) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)) {
      assert.ok(existsSync(join(dirname(file), spec)), `${relative(root, file)} imports ${spec}`);
    }
  }
});
