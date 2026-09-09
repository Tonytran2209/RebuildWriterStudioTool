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
      const haystack = terms(
        [
          item.title,
          item.description,
          item.contentType,
          ...(item.topics ?? []),
          ...(item.services ?? []),
          item.audience,
        ].join(" "),
      )
      const overlap = haystack.filter((term) => query.has(term)).length
      const typeBoost =
        item.contentType === "service" || item.contentType === "portfolio"
          ? 1
          : 0
      return { item, score: overlap * 3 + typeBoost }
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
      relevanceScore: score,
    }))
}
