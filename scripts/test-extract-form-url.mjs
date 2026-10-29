/**
 * Quick sanity check for extractGoogleFormUrl (prefer =3, keep full prefill).
 * Run: node --experimental-strip-types isn't needed — import via dynamic build.
 * Prefer: npx tsx or compile. This file inlines the same rules for a smoke test.
 */
import assert from "node:assert/strict";

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

function normalizeGoogleFormUrl(raw) {
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

function extractGoogleFormUrl(body) {
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

const base =
  "https://docs.google.com/forms/d/e/1FAIpQLSckv-mGLwVCZ-hbrErqd-c1n7AaanLWiCqiqYiaa7BexOxNDA/viewform?usp=pp_url&entry.123=Lucas%20Molina&entry.2115622678=";

const html = `
<p>Rate the collab</p>
<a href="${base}1">1</a>
<a href="${base}2">2</a>
<a href="${base}3">3</a>
<a href="${base}4">4</a>
<a href="${base}5">5</a>
`;

const plain = `
Please fill: ${base.replace(/%20/g, " ")}1
or good: ${base}3
or great: ${base}5
`;

const gotHtml = extractGoogleFormUrl(html);
assert.ok(gotHtml, "html extract");
assert.ok(gotHtml.endsWith("=3"), `prefer =3, got ${gotHtml}`);
assert.ok(
  gotHtml.includes("Lucas%20Molina") || gotHtml.includes("Lucas Molina"),
  "keeps full prefill",
);

const gotPlain = extractGoogleFormUrl(plain);
assert.ok(gotPlain, "plain extract");
assert.ok(gotPlain.endsWith("=3"), `plain prefer =3, got ${gotPlain}`);
assert.ok(
  /Lucas(%20| )Molina/.test(gotPlain),
  "plain keeps name with space/%20",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      htmlEndsWith3: gotHtml.endsWith("=3"),
      sample: gotHtml,
      plainSample: gotPlain,
    },
    null,
    2,
  ),
);
