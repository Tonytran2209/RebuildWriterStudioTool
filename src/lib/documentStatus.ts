import type { ActionDataSource, AppConfig, DocumentFile, StepFileAccess } from "../types";

export function hasStoredContent(content: unknown): content is string {
  return typeof content === "string" && content.trim().length > 0;
}

export function isDocumentReady(file: DocumentFile): boolean {
  return hasStoredContent(file.content);
}

export function isActionSourceReady(source: ActionDataSource): boolean {
  return hasStoredContent(source.content);
}

export function sanitizeStepFileAccess(
  access: StepFileAccess,
  files: DocumentFile[],
  sources: ActionDataSource[],
): StepFileAccess {
  const validKb = new Set(files.filter(file => file.category === "kb" && isDocumentReady(file)).map(file => file.id));
  const validRules = new Set(files.filter(file => file.category === "rules" && isDocumentReady(file)).map(file => file.id));
  const validActions = new Set(sources.filter(isActionSourceReady).map(source => source.id));
  return {
    kb: (access.kb ?? []).filter(id => validKb.has(id)),
    action: (access.action ?? []).filter(id => validActions.has(id)),
    rules: (access.rules ?? []).filter(id => validRules.has(id)),
  };
}

export function sanitizeConfigFileAccess(config: AppConfig, files: DocumentFile[]): AppConfig {
  const sources = config.actionSources ?? [];
  return {
    ...config,
    stepConfigs: Object.fromEntries(
      Object.entries(config.stepConfigs).map(([step, stepConfig]) => {
        const fileAccess = sanitizeStepFileAccess(stepConfig.fileAccess, files, sources);
        const documentPromptRules = Object.fromEntries(
          (['kb', 'action', 'rules'] as const).map(category => {
            const authorized = new Set(fileAccess[category]);
            const rules = Object.fromEntries(
              Object.entries(stepConfig.documentPromptRules?.[category] ?? {})
                .filter(([id, rule]) => authorized.has(id) && rule.trim())
                .map(([id, rule]) => [id, rule.trim()]),
            );
            return [category, rules];
          }),
        );
        return [step, { ...stepConfig, fileAccess, documentPromptRules }];
      }),
    ),
  };
}
