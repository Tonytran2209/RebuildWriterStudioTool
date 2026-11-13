import { normalizeDraftOutput, markdownToHtml } from "../src/lib/draftExport.ts"

function canonicalHeading(value: string) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*_`]/g, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function assignDocumentHeadings(
  draft: string,
  title: string,
  outline: Array<{ heading?: string; level?: string }>,
) {
  const headingLevels = new Map(
    outline
      .filter((section) => section?.heading)
      .map(
        (section) =>
          [
            canonicalHeading(String(section.heading)),
            section.level === "h3" ? 3 : 2,
          ] as const,
      ),
  )
  const canonicalTitle = canonicalHeading(title)
  const lines = draft.replace(/\r\n?/g, "\n").split("\n")
  let hasH1 = false
  const formatted = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ""
    const existing = trimmed.match(/^(#{1,6})\s+(.+)$/)
    const text = existing?.[2]?.trim() ?? trimmed
    const canonical = canonicalHeading(text)
    if (canonicalTitle && canonical === canonicalTitle) {
      hasH1 = true
      return `# ${text}`
    }
    const outlineLevel = headingLevels.get(canonical)
    if (outlineLevel) return `${"#".repeat(outlineLevel)} ${text}`
    if (existing) {
      const level = Math.min(3, Math.max(1, existing[1].length))
      if (level === 1) hasH1 = true
      return `${"#".repeat(level)} ${text}`
    }
    return line.trimEnd()
  })
  if (!hasH1 && title.trim()) formatted.unshift(`# ${title.trim()}`, "")
  return formatted
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function formatDraftExport(draft: string, title: string, outline: Array<{ heading?: string; level?: string }> = []) {
  const markdown = assignDocumentHeadings(normalizeDraftOutput(draft), normalizeDraftOutput(title), outline.map(section => ({ ...section, heading: normalizeDraftOutput(section.heading ?? "") })))
  return { markdown, html: markdownToHtml(markdown), formatter: "deterministic-v2", aiCalls: 0 }
}
