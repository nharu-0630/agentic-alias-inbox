import { failure } from "./api.js";
import { cryptoRandomBytes, randomLocalPart } from "./generate.js";
import { pageUrlOf, siteOf } from "./site.js";

const MAX_ATTEMPTS = 3;

// The mailbox exists on the server before the record is saved or any field is filled,
// so an address is never handed out without a mailbox behind it.
export async function createAlias({ settings, api, store, url, randomBytes = cryptoRandomBytes, now = () => new Date() }) {
  let page;
  try {
    page = { site: siteOf(url), url: pageUrlOf(url) };
  } catch {
    return failure("bad-request", undefined, "ページの URL を解釈できません");
  }
  let last;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const localPart = randomLocalPart(randomBytes);
    const email = `${localPart}@${settings.domain}`;
    // The mailbox name becomes the From display name on replies, so it must not reveal the site.
    last = await api.createMailbox(email, localPart);
    if (last.ok) {
      const record = { email, ...page, createdAt: now().toISOString() };
      await store.add(record);
      return { ok: true, email, record };
    }
    if (last.kind !== "exists") return last;
  }
  return failure("exists", last.status, `${MAX_ATTEMPTS} 回試行しました`);
}
