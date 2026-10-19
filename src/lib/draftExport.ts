// Presentation/export only: never write this normalized copy back to storage.
export function normalizeDraftOutput(text: string): string {
  return text.replace(/\u2014/g, '-');
}

export function normalizeDraftHtml(html: string): string {
  return normalizeDraftOutput(html).replace(/&(?:mdash|#0*8212|#x0*2014);/gi, '-');
}
