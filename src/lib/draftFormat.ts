/** Draft layout choices frozen on the article at draft time from Settings › Workflow rules (G3). Absent = defaults. */
export type DraftFormat = { conclusionHeading?: string; titleKeyword?: boolean };

export const DEFAULT_CONCLUSION_HEADING = 'Conclusion';
export const conclusionHeadingOf = (article?: { draftFormat?: DraftFormat | null } | null) =>
  article?.draftFormat?.conclusionHeading?.trim() || DEFAULT_CONCLUSION_HEADING;
export const titleKeywordRequired = (article?: { draftFormat?: DraftFormat | null } | null) => article?.draftFormat?.titleKeyword !== false;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `## <heading>` on its own line. */
export const conclusionHeadingPattern = (heading = DEFAULT_CONCLUSION_HEADING, flags = 'im') =>
  new RegExp(`^##\\s+${escape(heading.trim())}\\s*$`, flags);
