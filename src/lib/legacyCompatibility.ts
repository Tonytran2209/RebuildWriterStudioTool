import type { Article, DocumentFile } from "../types"

export function hasLegacyOutputs(article: Article): boolean {
  return Boolean(
    article.draft?.trim() ||
      article.outline?.length ||
      article.coreIdeaSuggestions?.length ||
      article.contentTypeSuggestions?.length,
  )
}

export function isLegacyArticle(article: Article): boolean {
  if (article.legacyReadOnly) return true
  const hasPlanContract = Boolean(
    article.contentPlanId &&
      (article.contentPlanSourceItemId ||
        article.contentPlanItemId ||
        article.selectedContentTypeSuggestionId) &&
      article.contentPlanInput?.trim(),
  )
  return !hasPlanContract && hasLegacyOutputs(article)
}

export function isLegacyActionPlan(file: DocumentFile): boolean {
  return file.category === "action" || file.category === "action-plan"
}
