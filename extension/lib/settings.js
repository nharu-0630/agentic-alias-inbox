export const SETTINGS_KEY = "settings";
export const DEFAULT_DOMAIN = "4zk.net";

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const asText = (v) => (typeof v === "string" ? v.trim() : "");

function parseWorkerUrl(raw) {
  const text = asText(raw);
  if (!text) return { error: "Worker URL を入力してください" };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: "URL の形式が正しくありません" };
  }
  if (url.protocol !== "https:") return { error: "https:// の URL を指定してください" };
  return { value: url.origin };
}

function parseRequired(label) {
  return (raw) => {
    const text = asText(raw);
    return text ? { value: text } : { error: `${label} を入力してください` };
  };
}

function parseDomain(raw) {
  const text = asText(raw).replace(/^@/, "").toLowerCase();
  if (!text) return { error: "ドメインを入力してください" };
  return DOMAIN_RE.test(text) ? { value: text } : { error: "ドメインの形式が正しくありません" };
}

const FIELDS = {
  workerUrl: parseWorkerUrl,
  clientId: parseRequired("Client ID"),
  clientSecret: parseRequired("Client Secret"),
  domain: parseDomain,
};

export function parseSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = {};
  const errors = {};
  for (const [field, parse] of Object.entries(FIELDS)) {
    const result = parse(source[field]);
    if ("error" in result) errors[field] = result.error;
    else settings[field] = result.value;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings };
}
