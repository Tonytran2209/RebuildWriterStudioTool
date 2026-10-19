import { normalizeDraftOutput } from "../src/lib/draftExport.ts"

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
}

function tableCells(line: string) {
  const text = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const cells: string[] = []
  let cell = ''
  let codeTicks = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\' && text[index + 1] === '|') {
      cell += '|'
      index++
    } else if (text[index] === '`') {
      const ticks = text.slice(index).match(/^`+/)![0].length
      if (!codeTicks) codeTicks = ticks
      else if (codeTicks === ticks) codeTicks = 0
      cell += '`'.repeat(ticks)
      index += ticks - 1
    } else if (text[index] === '|' && !codeTicks) {
      cells.push(cell.trim())
      cell = ''
    } else cell += text[index]
  }
  cells.push(cell.trim())
  return cells
}

function markdownForGoogleDocs(markdown: string) {
  const html: string[] = ["<div>"]
  let listType: "ul" | "ol" | null = null
  const closeList = () => {
    if (listType) html.push(`</${listType}>`)
    listType = null
  }
  const lines = markdown.split("\n")
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    const header = tableCells(line)
    const separator = tableCells(lines[index + 1] ?? '')
    if (line.includes('|') && header.length === separator.length && separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
      closeList()
      const alignment = separator.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left')
      const row = (cells: string[], tag: 'th' | 'td') => `<tr>${header.map((_, column) => `<${tag} style="border:1px solid #cccccc;padding:6px;text-align:${alignment[column]}">${inlineMarkdown(cells[column] ?? '')}</${tag}>`).join('')}</tr>`
      html.push('<table style="border-collapse:collapse;width:100%"><thead>', row(header, 'th'), '</thead><tbody>')
      index += 2
      while (index < lines.length && lines[index].trim().includes('|')) {
        html.push(row(tableCells(lines[index]), 'td'))
        index++
      }
      index--
      html.push('</tbody></table>')
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeList()
      html.push('<hr>')
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    const unordered = line.match(/^[-*]\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const nextType = unordered ? "ul" : "ol"
      if (listType !== nextType) {
        closeList()
        listType = nextType
        html.push(`<${nextType}>`)
      }
      html.push(`<li>${inlineMarkdown((unordered ?? ordered)![1])}</li>`)
      continue
    }
    closeList()
    html.push(`<p>${inlineMarkdown(line)}</p>`)
  }
  closeList()
  html.push("</div>")
  return html.join("")
}

export function formatDraftExport(draft: string, title: string, outline: Array<{ heading?: string; level?: string }> = []) {
  const markdown = assignDocumentHeadings(normalizeDraftOutput(draft), normalizeDraftOutput(title), outline.map(section => ({ ...section, heading: normalizeDraftOutput(section.heading ?? "") })))
  return { markdown, html: markdownForGoogleDocs(markdown), formatter: "deterministic-v2", aiCalls: 0 }
}
