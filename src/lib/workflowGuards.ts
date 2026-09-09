import type { Article, CoreIdeaSuggestion } from "../types";

export type ArticleWorkflowStep = 2 | 3 | 4;

export interface WorkflowGate {
  allowed: boolean;
  reason: string;
  reasonVi: string;
}

const allowed = (): WorkflowGate => ({ allowed: true, reason: "", reasonVi: "" });
const blocked = (reasonVi: string, reason: string): WorkflowGate => ({ allowed: false, reason, reasonVi });

export function selectedCoreIdea(article: Article): CoreIdeaSuggestion | null {
  if (!article.selectedCoreIdeaId || !article.coreIdeaSuggestions?.length) return null;
  return article.coreIdeaSuggestions.find((idea) => idea.id === article.selectedCoreIdeaId) ?? null;
}

export function hasContentPlanSelection(article: Article): boolean {
  const selectedPlanItem = article.contentPlanSourceItemId || article.contentPlanItemId || article.selectedContentTypeSuggestionId;
  return Boolean(
    article.contentPlanId
    && selectedPlanItem
    && article.contentPlanInput?.trim()
    && article.topic?.trim()
    && article.contentType?.trim(),
  );
}

export function gateArticleStep(article: Article, step: ArticleWorkflowStep): WorkflowGate {
  if (!hasContentPlanSelection(article)) {
    return blocked(
      "Hãy chọn một bài từ Content Plan đã phân loại trước khi bắt đầu Step 1.",
      "Select an article from a classified Content Plan before starting Step 1.",
    );
  }
  if (step === 2) return allowed();

  const idea = selectedCoreIdea(article);
  if (!idea || !article.articleSpec || !article.articleSpecFingerprint) {
    return blocked(
      "Step 2 chỉ mở sau khi Step 1 đã tạo Article Spec và bạn đã chọn một hướng nội dung.",
      "Step 2 unlocks after Step 1 creates an Article Spec and you select a direction.",
    );
  }
  if (step === 3) return allowed();

  if (!article.outline?.length || article.outline.some((section) => !section.heading?.trim())) {
    return blocked(
      "Step 3 chỉ mở sau khi Step 2 đã tạo và lưu một outline hợp lệ.",
      "Step 3 unlocks after Step 2 generates and saves a valid outline.",
    );
  }
  if (article.activityType === "editorial-originality" && article.editorialApproval?.status !== "approved") {
    return blocked(
      "Bài Editorial cần được phê duyệt outline trước khi tạo draft.",
      "Editorial articles require outline approval before draft generation.",
    );
  }
  return allowed();
}

export function gateStepCompletion(article: Article, step: ArticleWorkflowStep): WorkflowGate {
  const access = gateArticleStep(article, step);
  if (!access.allowed) return access;
  if (step === 2 && (!selectedCoreIdea(article) || !article.articleSpec)) {
    return blocked(
      "Hãy tạo Core Ideas và chọn một ý tưởng trước khi tiếp tục.",
      "Generate Core Ideas and select one before continuing.",
    );
  }
  if (step === 3 && (!article.outline?.length || article.outline.some((section) => !section.heading?.trim()))) {
    return blocked(
      "Hãy tạo và lưu outline hợp lệ trước khi tiếp tục.",
      "Generate and save a valid outline before continuing.",
    );
  }
  if (step === 3 && article.activityType === "editorial-originality" && article.editorialApproval?.status !== "approved") {
    return blocked(
      "Hãy phê duyệt outline Editorial trước khi tiếp tục tạo draft.",
      "Approve the Editorial outline before continuing to draft generation.",
    );
  }
  return allowed();
}

export function highestReachableStep(article: Article): ArticleWorkflowStep {
  if (gateArticleStep(article, 4).allowed) return 4;
  if (gateArticleStep(article, 3).allowed) return 3;
  return 2;
}

export function clampArticleStep(article: Article): ArticleWorkflowStep {
  const requested = Math.min(4, Math.max(2, Number(article.currentStep) || 2)) as ArticleWorkflowStep;
  return Math.min(requested, highestReachableStep(article)) as ArticleWorkflowStep;
}
