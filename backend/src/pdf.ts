import PDFDocument from 'pdfkit';

export function generateStatementPdf(title: string, headers: string[], rows: string[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(title, { align: 'center' });
    doc.moveDown(0.5);

    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length));
      return Math.max(60, Math.min(180, maxLen * 6 + 20));
    });

    const drawRow = (cells: string[], bold: boolean): void => {
      let x = doc.page.margins.left;
      const y = doc.y;
      cells.forEach((cell, i) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.fontSize(9).text(String(cell), x, y, { width: colWidths[i], align: i === 0 ? 'left' : 'right', lineBreak: false });
        x += colWidths[i];
      });
      doc.y = y + 16;
    };

    drawRow(headers, true);
    for (const row of rows) drawRow(row, false);

    doc.end();
  });
}
