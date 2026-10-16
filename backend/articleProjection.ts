type ReferenceLookup = (table: string, id: string) => Promise<any | undefined>

// Resolve only relational references. The original KV payload remains intact
// so historical plan IDs can still be inspected or recovered later.
export async function resolveArticleProjection(article: any, lookup: ReferenceLookup) {
  const plan = article.contentPlanId
    ? await lookup("content_plans", article.contentPlanId)
    : undefined
  const item = plan && article.contentPlanSourceItemId
    ? await lookup("content_plan_items", article.contentPlanSourceItemId)
    : undefined
  return {
    ...article,
    contentPlanId: plan?.id ?? null,
    contentPlanSourceItemId: item?.content_plan_id === plan?.id ? item?.id ?? null : null,
  }
}
