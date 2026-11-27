import crypto from "crypto"
import dns from "dns/promises"
import net from "net"

const MAX_HTML_BYTES = 2_000_000
const MAX_REDIRECTS = 5

function privateIp(address: string): boolean {
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (mappedIpv4) return privateIp(mappedIpv4)
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  const value = address.toLocaleLowerCase()
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:")
  )
}

async function readLimitedHtml(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let html = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_HTML_BYTES) {
      await reader.cancel()
      throw new Error("HTML response is too large.")
    }
    html += decoder.decode(value, { stream: true })
  }
  return html + decoder.decode()
}

async function assertPublicUrl(raw: string) {
  const url = new URL(raw)
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP and HTTPS URLs are supported.")
  if (url.username || url.password)
    throw new Error("URLs containing credentials are not allowed.")
  if (
    ["localhost", "localhost.localdomain"].includes(
      url.hostname.toLocaleLowerCase(),
    )
  )
    throw new Error("Local network URLs are not allowed.")
  const addresses = await dns.lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((item) => privateIp(item.address)))
    throw new Error("Private or unresolved network targets are not allowed.")
  return url
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
}
function meta(html: string, name: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  const tag = tags.find((item) =>
    new RegExp(`(?:name|property)=["']${name}["']`, "i").test(item),
  )
  return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? "")
}
function textOf(html: string, tag: string) {
  return decode(
    html
      .match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]
      ?.replace(/<[^>]+>/g, " ") ?? "",
  )
}
function canonical(html: string) {
  return (
    html.match(
      /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["']/i,
    )?.[1] ??
    html.match(
      /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*canonical/i,
    )?.[1]
  )
}

function mainContent(html: string) {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
  const main = withoutNoise.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? withoutNoise.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? withoutNoise
  return decode(main
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n"))
    .slice(0, 30_000)
}

function classify(
  url: URL,
  title: string,
  description: string,
  headings: string[],
) {
  const corpus =
    `${url.pathname} ${title} ${description} ${headings.join(" ")}`.toLocaleLowerCase()
  const typeRules: Array<[string, RegExp]> = [
    ["service", /\b(service|services|solution|solutions)\b/],
    ["portfolio", /\b(portfolio|case-study|case studies|work)\b/],
    ["about", /\b(about|company|team)\b/],
    ["landing", /\b(landing|campaign|download|ebook|webinar)\b/],
    ["commercial", /\b(pricing|contact|book|quote)\b/],
    ["blog", /\b(blog|article|insight|guide|news)\b/],
  ]
  const matched = typeRules.find(([, pattern]) => pattern.test(corpus))
  const contentType = (matched?.[0] ??
    "blog") as "blog" | "service" | "portfolio" | "landing" | "about" | "commercial"
  const topicCandidates = [
    "healthcare",
    "education",
    "training",
    "animation",
    "communication",
    "marketing",
    "learning",
    "medical",
    "technology",
    "business",
  ]
  const topics = topicCandidates
    .filter((topic) => corpus.includes(topic))
    .slice(0, 5)
  const serviceCandidates = [
    "2d animation",
    "3d animation",
    "motion graphics",
    "whiteboard animation",
    "explainer video",
    "training video",
    "educational video",
    "video production",
  ]
  const services = serviceCandidates
    .filter((service) => corpus.includes(service))
    .slice(0, 4)
  const evidence =
    (matched ? 1 : 0) +
    (topics.length ? 1 : 0) +
    (services.length ? 1 : 0) +
    (title ? 1 : 0) +
    (description ? 1 : 0)
  return {
    contentType,
    topics,
    services,
    confidence: Math.min(0.96, 0.42 + evidence * 0.1),
  }
}

/** GET a public URL, following redirects manually so every hop is checked against private networks. */
async function fetchPublic(raw: string, userAgent: string) {
  let current = await assertPublicUrl(raw.trim())
  const original = current.toString()
  let redirected = false
  let response: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml" },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get("location")
    if (!location) break
    current = await assertPublicUrl(new URL(location, current).toString())
    redirected = true
    if (hop === MAX_REDIRECTS) throw new Error("Too many redirects.")
  }
  if (!response) throw new Error("Website did not return a response.")
  return { response, current, original, redirected }
}

/**
 * Reads a competitor page for G1 competitor analysis: title, H1–H3 headings (in order, with level) and
 * main text (capped). Same network safeguards as the inventory scan. Throws when the page is not readable HTML.
 */
export async function fetchPublicPage(raw: string, maxTextChars = 6_000) {
  const { response, current } = await fetchPublic(raw, "WriterStudioResearchBot/1.0 (+content research)")
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) throw new Error("Not an HTML page.")
  if (Number(response.headers.get("content-length") ?? 0) > MAX_HTML_BYTES) throw new Error("HTML response is too large.")
  const html = await readLimitedHtml(response)
  const text = mainContent(html)
  const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => `H${match[1]} ${decode(match[2].replace(/<[^>]+>/g, " "))}`)
    .filter((heading) => heading.length > 3)
    .slice(0, 40)
  return {
    url: current.toString(),
    title: (textOf(html, "title") || meta(html, "og:title") || textOf(html, "h1") || current.hostname).slice(0, 200),
    headings,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    text: text.slice(0, maxTextChars),
  }
}

export async function scanWebsiteUrl(raw: string) {
  const { response, current, original, redirected } = await fetchPublic(raw, "WriterStudioInventoryBot/1.0 (+website inventory verification)")
  const checkedAt = new Date().toISOString()
  if (!response.ok)
    return {
      url: original,
      title: current.hostname,
      contentType: "blog",
      topics: [],
      services: [],
      status: "broken",
      eligibleForInternalLink: false,
      lastChecked: checkedAt,
      httpStatus: response.status,
      crawlStatus: "failed",
      lastError: `HTTP ${response.status}`,
      classificationConfidence: 0,
    }
  const type = response.headers.get("content-type") ?? ""
  if (!type.includes("text/html"))
    throw new Error("URL does not return an HTML page.")
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_HTML_BYTES) throw new Error("HTML response is too large.")
  const html = await readLimitedHtml(response)
  const extractedContent = mainContent(html)
  const title =
    textOf(html, "title") ||
    meta(html, "og:title") ||
    textOf(html, "h1") ||
    current.hostname
  const description = meta(html, "description") || meta(html, "og:description")
  const headings = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .slice(0, 20)
    .map((match) => decode(match[1].replace(/<[^>]+>/g, " ")))
  const detected = classify(current, title, description, headings)
  const canonicalHref = canonical(html)
  const canonicalCandidate = canonicalHref
    ? new URL(canonicalHref, current)
    : undefined
  const canonicalUrl =
    canonicalCandidate?.hostname === current.hostname
      ? canonicalCandidate.toString()
      : undefined
  return {
    url: original,
    canonicalUrl,
    title,
    description,
    contentType: detected.contentType,
    topics: detected.topics,
    services: detected.services,
    status: redirected ? "redirected" : "active",
    redirectTarget: redirected ? current.toString() : undefined,
    eligibleForInternalLink: true,
    lastChecked: checkedAt,
    httpStatus: response.status,
    crawlStatus: "complete",
    classificationConfidence: detected.confidence,
    contentFingerprint: crypto
      .createHash("sha256")
      .update(extractedContent || `${title}\n${description}\n${headings.join("\n")}`)
      .digest("hex"),
    extractedContent,
  }
}

export { selectInternalLinkCandidates as selectWebsiteCandidates } from "../src/lib/internalLinkInventory.ts"

/* ─── Sitemap / llms.txt import (URL source for the inventory crawl) ─── */

export const MAX_SITEMAP_URLS = 2000
const MAX_SITEMAP_FILES = 50
const sameSite = (a: string, b: string) => a.replace(/^www\./, "").toLowerCase() === b.replace(/^www\./, "").toLowerCase()

/** <loc> values of a sitemap: page URLs from a urlset, child sitemaps from a sitemapindex. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = (block: string) => [...block.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((match) => decode(match[1]))
  const sitemaps = [...xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)].flatMap((match) => locs(match[1]))
  const urls = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap((match) => locs(match[1]))
  return { urls, sitemaps }
}

/** Links of an llms.txt (markdown "- [title](url): description"), resolved against the site. */
export function parseLlmsTxt(text: string, base: string): Array<{ url: string; title: string; description: string }> {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/.exec(line)
    if (!match) return []
    try {
      return [{ url: new URL(match[2], base).toString(), title: match[1].trim().slice(0, 200), description: (match[3] ?? "").trim().slice(0, 600) }]
    } catch { return [] }
  })
}

/** Sitemap URLs listed in robots.txt ("Sitemap: …" lines). */
export function robotsSitemaps(text: string, base: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
    if (!match) return []
    try { return [new URL(match[1], base).toString()] } catch { return [] }
  })
}

async function fetchPublicText(raw: string) {
  const { response } = await fetchPublic(raw, "WriterStudioInventoryBot/1.0 (+sitemap import)")
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (Number(response.headers.get("content-length") ?? 0) > MAX_HTML_BYTES) throw new Error("Response is too large.")
  return readLimitedHtml(response)
}

/**
 * The site's page URLs from its sitemaps (robots.txt Sitemap lines, else /sitemap.xml and /sitemap_index.xml,
 * following sitemap indexes) and the descriptions of its llms.txt. Same-site URLs only, at most 2000.
 * A missing llms.txt is normal; no readable sitemap is an error.
 */
export async function discoverSiteUrls(siteUrl: string) {
  const origin = (await assertPublicUrl(siteUrl.trim())).origin
  const host = new URL(origin).hostname
  const errors: string[] = []
  const robots = await fetchPublicText(`${origin}/robots.txt`).catch(() => "")
  const queue = [...new Set([...robotsSitemaps(robots, origin), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])]
  const visited = new Set<string>()
  const urls = new Set<string>()
  let read = 0
  while (queue.length && visited.size < MAX_SITEMAP_FILES && urls.size < MAX_SITEMAP_URLS) {
    const sitemap = queue.shift()!
    if (visited.has(sitemap)) continue
    visited.add(sitemap)
    try {
      if (!sameSite(new URL(sitemap).hostname, host)) continue
      if (/\.gz($|\?)/i.test(sitemap)) { errors.push(`${sitemap}: compressed sitemaps are not supported`); continue }
      const parsed = parseSitemap(await fetchPublicText(sitemap))
      if (!parsed.urls.length && !parsed.sitemaps.length) continue
      read += 1
      queue.push(...parsed.sitemaps.filter((child) => !visited.has(child)))
      for (const url of parsed.urls) {
        try { if (["http:", "https:"].includes(new URL(url).protocol) && sameSite(new URL(url).hostname, host)) urls.add(url) } catch { /* skip */ }
        if (urls.size >= MAX_SITEMAP_URLS) break
      }
    } catch (error) {
      // The two default locations are guesses; only report sitemaps the site declared or linked.
      if (!/\/sitemap(_index)?\.xml$/.test(sitemap) || robots.includes(sitemap)) errors.push(`${sitemap}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const llmsText = await fetchPublicText(`${origin}/llms.txt`).catch(() => "")
  const llms = parseLlmsTxt(llmsText, origin).filter((item) => { try { return sameSite(new URL(item.url).hostname, host) } catch { return false } })
  return { origin, urls: [...urls], sitemapsRead: read, sitemapsTried: visited.size, llms, errors: errors.slice(0, 10) }
}
