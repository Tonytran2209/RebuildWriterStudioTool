import type { Article, WebsiteContentRecord } from "../types"

const terms = (value: unknown) =>
  String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)

export function selectInternalLinkCandidates(
  article: Article,
  inventory: WebsiteContentRecord[],
  limit = 6,
) {
  const query = new Set(
    terms(
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
        (item.status === "active" || item.status === "redirected"),
    )
    .map((item) => {
      const overlap = (value: unknown) => terms(value).filter((term) => query.has(term)).length
      const semanticScore =
        overlap(`${item.title} ${item.primaryTopic}`) * 5 +
        overlap((item.topics ?? []).join(" ")) * 4 +
        overlap((item.services ?? []).join(" ")) * 4 +
        overlap((item.internalLinkAnchors ?? []).join(" ")) * 3 +
        overlap(`${item.summary ?? ""} ${item.description ?? ""} ${item.audience ?? ""}`)
      const typeBoost =
        item.contentType === "service" || item.contentType === "portfolio"
          ? 1
          : 0
      return { item, score: semanticScore + typeBoost }
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title),
    )
    .slice(0, Math.max(1, limit))
    .map(({ item, score }) => ({
      title: item.title,
      url: item.redirectTarget || item.canonicalUrl || item.url,
      pageType: item.contentType,
      topics: item.topics,
      services: item.services ?? [],
      summary: item.summary,
      searchIntent: item.searchIntent,
      suggestedAnchors: item.internalLinkAnchors ?? [],
      relevanceScore: score,
    }))
}
