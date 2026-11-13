import { test } from "node:test";
import assert from "node:assert/strict";
import { randomLocalPart } from "../extension/lib/generate.js";
import { bytes } from "./helpers.js";

test("default generator yields 10 chars from [a-z0-9] and varies", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const part = randomLocalPart();
    assert.match(part, /^[a-z0-9]{10}$/);
    seen.add(part);
  }
  assert.equal(seen.size, 200);
});

test("maps bytes through the injected RNG", () => {
  const part = randomLocalPart(() => bytes(0, 1, 25, 26, 35, 36, 37, 71, 72, 251));
  assert.equal(part, "abz09ab9a9");
});

test("skips bytes at or above 252 instead of wrapping them", () => {
  const batches = [bytes(252, 255, 0, 253, 1, 254, 2, 3, 4, 5), bytes(6, 7, 8, 9, 10, 11, 12, 13, 14, 15)];
  const part = randomLocalPart(() => batches.shift());
  assert.equal(part, "abcdefghij");
});
