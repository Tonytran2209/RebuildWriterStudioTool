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

export async function scanWebsiteUrl(raw: string) {
  let current = await assertPublicUrl(raw.trim())
  const original = current.toString()
  let redirected = false
  let response: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "user-agent":
          "WriterStudioInventoryBot/1.0 (+website inventory verification)",
        accept: "text/html,application/xhtml+xml",
      },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get("location")
    if (!location) break
    current = await assertPublicUrl(new URL(location, current).toString())
    redirected = true
    if (hop === MAX_REDIRECTS) throw new Error("Too many redirects.")
  }
  if (!response) throw new Error("Website did not return a response.")
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
      .update(`${title}\n${description}\n${headings.join("\n")}`)
      .digest("hex"),
  }
}

const candidateTerms = (value: unknown) =>
  String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
export function selectWebsiteCandidates(
  article: any,
  inventory: any[],
  limit = 6,
) {
  const query = new Set(
    candidateTerms(
      [
        article.topic,
        article.angle,
        article.keywords,
        article.contentType,
        article.targetAudience,
        ...(article.articleSpec?.mustCover ?? []),
      ].join(" "),
    ),
  )
  return inventory
    .filter(
      (item) =>
        item.eligibleForInternalLink &&
        ["active", "redirected"].includes(item.status),
    )
    .map((item) => {
      const overlap = candidateTerms(
        [
          item.title,
          item.description,
          item.contentType,
          ...(item.topics ?? []),
          ...(item.services ?? []),
          item.audience,
        ].join(" "),
      ).filter((term) => query.has(term)).length
      return {
        item,
        score:
          overlap * 3 +
          (["service", "portfolio"].includes(item.contentType) ? 1 : 0),
      }
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.item.title).localeCompare(String(b.item.title)),
    )
    .slice(0, limit)
    .map(({ item, score }) => ({
      title: item.title,
      url: item.redirectTarget || item.canonicalUrl || item.url,
      pageType: item.contentType,
      topics: item.topics ?? [],
      services: item.services ?? [],
      relevanceScore: score,
    }))
}
