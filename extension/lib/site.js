export function siteOf(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

export function pageUrlOf(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}
