function rowsToCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(cell => {
    const value = cell == null ? "" : String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",")).join("\n");
}

export async function extractDocumentText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "txt";
  if (["csv", "tsv", "json", "txt", "xml", "md"].includes(ext)) return file.text();

  if (ext === "xlsx") {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheets.map(({ sheet, data }) => `[Sheet: ${sheet}]\n${rowsToCsv(data)}`).join("\n\n");
  }

  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(`[Trang ${pageNumber}]\n${text.items.map(item => "str" in item ? item.str : "").join(" ")}`);
    }
    return pages.join("\n\n");
  }

  if (ext === "docx" || ext === "doc") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  throw new Error(`Định dạng .${ext} chưa được hỗ trợ.`);
}
