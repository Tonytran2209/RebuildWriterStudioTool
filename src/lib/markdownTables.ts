function cells(line: string, separator = "|") {
  const trimmed = line.trim()
  const source = separator === "|"
    ? trimmed.replace(/^\|/, "").replace(/\|$/, "")
    : trimmed
  return source.split(separator).map((cell) => cell.trim())
}

function isDivider(line: string) {
  const values = cells(line)
  return values.length > 1 && values.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function asPipeRow(values: string[]) {
  return `| ${values.join(" | ")} |`
}

/**
 * Keeps valid GFM tables intact and upgrades simple pipe/tab-delimited blocks
 * to GFM before they reach the preview or clipboard formatter. It never asks
 * an AI model to infer table structure.
 */
export function normalizeMarkdownTables(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const output: string[] = []
  let index = 0
  let inFence = false

  while (index < lines.length) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      output.push(line)
      index += 1
      continue
    }
    if (inFence || (!line.includes("|") && !line.includes("\t")) || isDivider(lines[index + 1] ?? "")) {
      output.push(line)
      index += 1
      continue
    }

    const header = cells(line)
    const pipeRows: string[][] = []
    let cursor = index + 1
    while (cursor < lines.length && lines[cursor].includes("|")) {
      const row = cells(lines[cursor])
      if (row.length !== header.length || row.some((cell) => !cell)) break
      pipeRows.push(row)
      cursor += 1
    }
    if (header.length > 1 && header.every(Boolean) && pipeRows.length) {
      output.push(asPipeRow(header))
      output.push(asPipeRow(header.map(() => "---")))
      pipeRows.forEach((row) => output.push(asPipeRow(row)))
      index = cursor
      continue
    }

    if (!line.includes("\t")) {
      output.push(line)
      index += 1
      continue
    }
    const tabHeader = cells(line, "\t")
    const tabRows: string[][] = []
    cursor = index + 1
    while (cursor < lines.length && lines[cursor].includes("\t")) {
      const row = cells(lines[cursor], "\t")
      if (row.length !== tabHeader.length || row.some((cell) => !cell)) break
      tabRows.push(row)
      cursor += 1
    }
    if (tabHeader.length > 1 && tabHeader.every(Boolean) && tabRows.length) {
      output.push(asPipeRow(tabHeader))
      output.push(asPipeRow(tabHeader.map(() => "---")))
      tabRows.forEach((row) => output.push(asPipeRow(row)))
      index = cursor
      continue
    }
    output.push(line)
    index += 1
  }
  return output.join("\n")
}

export function markdownTableCells(line: string) {
  return cells(line)
}

export function isMarkdownTableDivider(line: string) {
  return isDivider(line)
}
