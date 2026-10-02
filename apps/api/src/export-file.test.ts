import { describe, expect, test } from "vitest";
import { buildExport, tableFromResult } from "./export-file";

describe("exports", () => {
  test("a row result becomes a table and a pdf", async () => {
    const table = tableFromResult({ jobs: [{ title: "Engineer", company: "Acme" }] });
    expect(table?.columns).toEqual(["title", "company"]);
    const file = await buildExport({ format: "pdf", title: "Jobs", table });
    expect(file.filename.endsWith(".pdf")).toBe(true);
    expect(file.bytes[0]).toBe(0x25);
  });

  test("a reply becomes a word file", async () => {
    const file = await buildExport({ format: "docx", title: "Chat", text: "Findings go here." });
    expect(file.bytes[0]).toBe(0x50);
    expect(file.bytes[1]).toBe(0x4b);
  });
});
