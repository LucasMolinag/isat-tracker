/**
 * Extract Google Form URLs from email bodies.
 * Prefers links ending in =3; keeps the full prefilled query string.
 */

const GOOGLE_FORM_HOST = /(?:docs\.google\.com\/forms|forms\.gle)\//i;

function decodeHtmlEntities(input) {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

function unwrapGoogleRedirect(raw) {
  try {
    const u = new URL(raw);
    if (
      (u.hostname === "www.google.com" || u.hostname === "google.com") &&
      u.pathname === "/url"
    ) {
      const q = u.searchParams.get("q") || u.searchParams.get("url");
      if (q && GOOGLE_FORM_HOST.test(q)) return q;
    }
  } catch {
    // ignore
  }
  return raw;
}

export function normalizeGoogleFormUrl(raw) {
  let s = decodeHtmlEntities(raw.trim());
  s = unwrapGoogleRedirect(s);
  s = s.replace(/[\r\n\t]+/g, "");
  s = s.replace(/[),.;\]]+$/g, "");
  if (!GOOGLE_FORM_HOST.test(s)) return null;
  try {
    const encoded = s.replace(/ /g, "%20");
    const url = new URL(encoded);
    if (!GOOGLE_FORM_HOST.test(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function collectHrefCandidates(body) {
  const out = [];
  const hrefRe = /href\s*=\s*(["'])(.*?)\1/gi;
  let m;
  while ((m = hrefRe.exec(body))) {
    const href = m[2] ?? "";
    if (GOOGLE_FORM_HOST.test(href) || /google\.com\/url/i.test(href)) {
      out.push(href);
    }
  }
  return out;
}

function collectLooseCandidates(body) {
  const re =
    /https?:\/\/(?:docs\.google\.com\/forms|forms\.gle|www\.google\.com\/url)\/[^\s"'<>\\]+(?:[ \t]*[^\s"'<>\\]+)*/gi;
  return body.match(re) ?? [];
}

/**
 * @param {string} body
 * @returns {string | null}
 */
export function extractGoogleFormUrl(body) {
  if (!body) return null;

  const decoded = decodeHtmlEntities(body);
  const rawCandidates = [
    ...collectHrefCandidates(decoded),
    ...collectHrefCandidates(body),
    ...collectLooseCandidates(decoded),
    ...collectLooseCandidates(body),
  ];

  const normalized = rawCandidates
    .map(normalizeGoogleFormUrl)
    .filter(Boolean);

  if (normalized.length === 0) return null;

  const unique = [];
  const seen = new Set();
  for (const u of normalized) {
    if (seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
  }

  const preferDocs = unique.filter((u) => /docs\.google\.com\/forms/i.test(u));
  const pool = preferDocs.length > 0 ? preferDocs : unique;

  const endsWith3 = pool.find((u) => {
    try {
      const href = new URL(u).href.replace(/#.*$/, "");
      return href.endsWith("=3");
    } catch {
      return /[=]3$/i.test(u.trim().replace(/#.*$/, ""));
    }
  });
  if (endsWith3) return endsWith3;

  return pool[0];
}
