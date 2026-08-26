import type { ActionDataSource, AppConfig, DocumentFile, StepFileAccess } from "../types";

export function hasStoredContent(content: unknown): content is string {
  return typeof content === "string" && content.trim().length > 0;
}

export function isDocumentReady(file: DocumentFile): boolean {
  return hasStoredContent(file.content);
}

export function isImportSourceReady(source: ActionDataSource): boolean {
  return hasStoredContent(source.content);
}

export function sanitizeStepFileAccess(
  access: StepFileAccess,
  files: DocumentFile[],
): StepFileAccess {
  const validKb = new Set(files.filter(file => file.category === "kb" && isDocumentReady(file)).map(file => file.id));
  const validRules = new Set(files.filter(file => file.category === "rules" && isDocumentReady(file)).map(file => file.id));
  return {
    kb: (access.kb ?? []).filter(id => validKb.has(id)),
    rules: (access.rules ?? []).filter(id => validRules.has(id)),
  };
}

export function sanitizeConfigFileAccess(config: AppConfig, files: DocumentFile[]): AppConfig {
  return {
    ...config,
    stepConfigs: Object.fromEntries(
      Object.entries(config.stepConfigs).map(([step, stepConfig]) => {
        const fileAccess = sanitizeStepFileAccess(stepConfig.fileAccess, files);
        const categoryPromptRules = Object.fromEntries(
          (['kb', 'rules'] as const).map(category => {
            const current = stepConfig.categoryPromptRules?.[category]?.trim();
            if (current) return [category, current];
            const migrated = Object.values(stepConfig.documentPromptRules?.[category] ?? {})
              .map(rule => rule.trim())
              .filter(Boolean)
              .filter((rule, index, rules) => rules.indexOf(rule) === index)
              .join('\n\n');
            return [category, migrated];
          }).filter(([, rule]) => Boolean(rule)),
        );
        const { documentPromptRules: _legacyRules, ...rest } = stepConfig;
        return [step, { ...rest, fileAccess, categoryPromptRules }];
      }),
    ),
  };
}
