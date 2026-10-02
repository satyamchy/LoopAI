import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ExportFormat = "pdf" | "xlsx" | "docx";

const TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function tableFromResult(result: unknown): { columns: string[]; rows: string[][] } | null {
  if (!result || typeof result !== "object") return null;
  const values = Object.values(result as Record<string, unknown>);
  const grid = values.find((item) => Array.isArray(item) && item.length > 0 && Array.isArray(item[0])) as unknown[][] | undefined;
  if (grid) {
    const width = Math.min(8, Math.max(...grid.slice(0, 500).map((row) => row.length)));
    const columns = Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
    return { columns, rows: grid.slice(0, 500).map((row) => columns.map((_, index) => cell(row[index]))) };
  }
  const objects = values.find((item) => Array.isArray(item) && item.length > 0 && isRow(item[0])) as Record<string, unknown>[] | undefined;
  if (!objects) return null;
  const columns = Object.keys(objects[0]).filter((key) => !/token|secret|password|authorization/i.test(key)).slice(0, 8);
  if (columns.length === 0) return null;
  return { columns, rows: objects.slice(0, 500).map((row) => columns.map((key) => cell(row[key]))) };
}

export async function manuscriptPdf(chapters: { title: string; body: string }[]): Promise<Uint8Array> {
  const text = chapters.map((chapter) => `${chapter.title}\n\n${chapter.body}`).join("\n\n");
  const file = await buildExport({ format: "pdf", title: "Manuscript", text });
  return file.bytes;
}

export async function buildExport(input: {
  format: ExportFormat;
  title: string;
  text?: string;
  table?: { columns: string[]; rows: string[][] } | null;
}): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  const title = input.title.slice(0, 80) || "LoopAI";
  const text = (input.text ?? "").slice(0, 20_000);
  const bytes = input.format === "pdf"
    ? await pdfBytes(title, text, input.table)
    : input.format === "xlsx"
      ? await xlsxBytes(input.table, text)
      : await docxBytes(title, text, input.table);
  return { bytes, contentType: TYPES[input.format], filename: fileName(title, input.format) };
}

function isRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value).slice(0, 500);
}

function fileName(title: string, ext: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "loopai";
  return `${base}.${ext}`;
}

function pdfSafe(text: string): string {
  return text.replace(/[^\t\n\r\x20-\x7E]/g, "?");
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) {
      lines.push("");
      continue;
    }
    for (let index = 0; index < raw.length; index += width) lines.push(raw.slice(index, index + width));
  }
  return lines.slice(0, 800);
}

async function pdfBytes(title: string, text: string, table?: { columns: string[]; rows: string[][] } | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const draw = (line: string, size: number, face: typeof font) => {
    if (y < 48) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    page.drawText(pdfSafe(line).slice(0, 110), { x: 40, y, size, font: face, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 6;
  };
  draw(title, 16, bold);
  if (table) {
    draw(table.columns.join(" | "), 9, bold);
    for (const row of table.rows) draw(row.join(" | "), 9, font);
  } else {
    for (const line of wrap(text, 90)) draw(line || " ", 11, font);
  }
  return doc.save();
}

async function xlsxBytes(table: { columns: string[]; rows: string[][] } | null | undefined, text: string): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Result");
  if (table) {
    sheet.addRow(table.columns);
    for (const row of table.rows) sheet.addRow(row);
  } else {
    sheet.addRow(["Text"]);
    for (const line of text.split(/\r?\n/).slice(0, 500)) sheet.addRow([line]);
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

async function docxBytes(title: string, text: string, table?: { columns: string[]; rows: string[][] } | null): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  if (table) {
    children.push(new Table({
      rows: [
        new TableRow({ children: table.columns.map((column) => wordCell(column)) }),
        ...table.rows.map((row) => new TableRow({ children: row.map((value) => wordCell(value)) })),
      ],
    }));
  } else {
    for (const line of text.split(/\r?\n/).slice(0, 500)) {
      children.push(new Paragraph({ children: [new TextRun(line || " ")] }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function wordCell(value: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun(value.slice(0, 500) || " ")] })] });
}
