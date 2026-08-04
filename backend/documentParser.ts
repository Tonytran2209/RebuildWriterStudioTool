import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/node';

function rowsToCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(cell => {
    const value = cell == null ? '' : String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\n');
}

export async function extractDocumentText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'txt';
  if (['csv', 'tsv', 'json', 'txt', 'xml', 'md'].includes(ext)) return buffer.toString('utf8');

  if (ext === 'xlsx') {
    const sheets = await readXlsxFile(buffer);
    return sheets.map(({ sheet, data }) => `[Sheet: ${sheet}]\n${rowsToCsv(data)}`).join('\n\n');
  }

  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(`[Trang ${pageNumber}]\n${text.items.map(item => 'str' in item ? item.str : '').join(' ')}`);
    }
    return pages.join('\n\n');
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error(`Định dạng .${ext} chưa được hỗ trợ.`);
}
