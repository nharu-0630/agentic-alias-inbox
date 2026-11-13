import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmailField } from "../extension/lib/field.js";

function input(attributes = {}, props = {}) {
  return {
    tagName: "INPUT",
    disabled: false,
    readOnly: false,
    ...props,
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
  };
}

const detected = [
  ["type=email", input({ type: "email" })],
  ["autocomplete=email", input({ type: "text", autocomplete: "email" })],
  ["autocomplete with section token", input({ autocomplete: "section-signup home email" })],
  ["name=email with no type", input({ name: "user_email" })],
  ["id e-mail", input({ type: "text", id: "E-Mail" })],
  ["Japanese placeholder", input({ type: "text", placeholder: "メールアドレス" })],
  ["aria-label", input({ "aria-label": "Your email" })],
];

const rejected = [
  ["password", input({ type: "password", name: "email" })],
  ["hidden type", input({ type: "hidden", name: "email" })],
  ["hidden attribute", input({ type: "email", hidden: "" })],
  ["aria-hidden", input({ type: "email", "aria-hidden": "true" })],
  ["disabled", input({ type: "email" }, { disabled: true })],
  ["readonly", input({ type: "email" }, { readOnly: true })],
  ["plain text field", input({ type: "text", name: "username" })],
  ["search with email name", input({ type: "search", name: "email" })],
  ["textarea", { ...input({ name: "email" }), tagName: "TEXTAREA" }],
  ["null", null],
];

for (const [label, el] of detected) test(`detects ${label}`, () => assert.equal(isEmailField(el), true));
for (const [label, el] of rejected) test(`rejects ${label}`, () => assert.equal(isEmailField(el), false));
