const EMAIL_HINT = /e-?mail|メール/i;
const TEXTUAL_TYPES = new Set(["text", "email", ""]);
const HINT_ATTRIBUTES = ["name", "id", "placeholder", "aria-label"];

// `el` needs only tagName, disabled, readOnly and getAttribute, so tests can pass plain objects.
export function isEmailField(el) {
  if (el?.tagName?.toUpperCase() !== "INPUT") return false;
  if (el.disabled || el.readOnly) return false;
  if (el.getAttribute("hidden") !== null || el.getAttribute("aria-hidden") === "true") return false;
  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (!TEXTUAL_TYPES.has(type)) return false;
  if (type === "email") return true;
  if ((el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).includes("email")) return true;
  return HINT_ATTRIBUTES.some((attr) => EMAIL_HINT.test(el.getAttribute(attr) ?? ""));
}
