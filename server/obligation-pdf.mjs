import { extractText, getDocumentProxy } from 'unpdf';
export async function extractObligationPdf(bytes) {
  if (bytes.length > 10 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Choose a PDF under 10 MB.');
  const pdf = await getDocumentProxy(bytes, { isEvalSupported: false, stopAtErrors: true });
  try {
    if (pdf.numPages > 200) throw new Error('Import documents with at most 200 pages.');
    const { text } = await extractText(pdf, { mergePages: false });
    const body = text.map((page, i) => `[Page ${i + 1}]\n${page}`).join('\n\n');
    if (!text.some(page => page.trim())) throw new Error('This PDF has no readable text. Paste text from scanned documents.');
    if (body.length > 200000) throw new Error('Document text exceeds 200,000 characters. Import a smaller document.');
    return body;
  } finally { await pdf.loadingTask.destroy(); }
}
