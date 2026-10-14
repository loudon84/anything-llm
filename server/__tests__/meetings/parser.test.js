const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { createParser } = require("../../modules/meetings/parser");

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries))
    zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

function textPdf(text) {
  const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

describe("located meeting source parsing", () => {
  test("parses text paragraphs with stable paragraph locations", async () => {
    const parser = createParser();
    const segments = await parser.parse({
      name: "notes.txt",
      buffer: Buffer.from("First paragraph\n\nSecond paragraph"),
    });
    expect(segments).toEqual([
      {
        text: "First paragraph",
        location: { type: "paragraph", paragraph: 0 },
      },
      {
        text: "Second paragraph",
        location: { type: "paragraph", paragraph: 1 },
      },
    ]);
  });

  test("extracts DOCX paragraphs with paragraph locations", async () => {
    const buffer = zipBuffer({
      "word/document.xml":
        '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Opening</w:t></w:r></w:p><w:p><w:r><w:t>Decision</w:t></w:r></w:p></w:body></w:document>',
    });
    const segments = await createParser().parse({
      name: "minutes.docx",
      buffer,
    });
    expect(segments.map((item) => [item.text, item.location])).toEqual([
      ["Opening", { type: "paragraph", paragraph: 0 }],
      ["Decision", { type: "paragraph", paragraph: 1 }],
    ]);
  });

  test("extracts PPTX slide text with slide locations", async () => {
    const buffer = zipBuffer({
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p"><a:t xmlns:a="a">Plan</a:t></p:sld>',
      "ppt/slides/slide2.xml":
        '<p:sld xmlns:p="p"><a:t xmlns:a="a">Risk</a:t></p:sld>',
    });
    const segments = await createParser().parse({
      name: "review.pptx",
      buffer,
    });
    expect(segments.map((item) => [item.text, item.location])).toEqual([
      ["Plan", { type: "slide", slide: 1 }],
      ["Risk", { type: "slide", slide: 2 }],
    ]);
  });

  test("runs configured OCR for embedded slide images while retaining native text", async () => {
    const buffer = zipBuffer({
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p"><a:t xmlns:a="a">Native heading</a:t><p:pic><p:blipFill><a:blip xmlns:a="a" r:embed="rId1"/></p:blipFill></p:pic></p:sld>',
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
      "ppt/media/image1.png": "fake-png-payload",
    });
    const fetchImpl = jest.fn(async (_url, options) => {
      expect(options.body.get("file").name).toBe("image1.png");
      return {
        ok: true,
        json: async () => ({
          segments: [
            { text: "Text in screenshot", location: { type: "image" } },
          ],
        }),
      };
    });
    const segments = await createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl,
    }).parse({
      name: "slides.pptx",
      buffer,
    });
    expect(segments).toEqual([
      { text: "Native heading", location: { type: "slide", slide: 1 } },
      { text: "Text in screenshot", location: { type: "slide", slide: 1 } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("extracts XLSX nonempty cell values and coordinates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Decisions");
    sheet.getCell("B2").value = "Approved budget";
    sheet.getCell("C4").value = 125;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const segments = await createParser().parse({
      name: "decisions.xlsx",
      buffer,
    });
    expect(segments.map((item) => [item.text, item.location])).toEqual([
      ["Approved budget", { type: "cell", sheet: "Decisions", cell: "B2" }],
      ["125", { type: "cell", sheet: "Decisions", cell: "C4" }],
    ]);
  });

  test("extracts text PDF pages with page locations", async () => {
    const segments = await createParser().parse({
      name: "decision.pdf",
      buffer: textPdf("Quarterly decision"),
    });
    expect(segments).toEqual([
      { text: "Quarterly decision", location: { type: "page", page: 1 } },
    ]);
  });

  test("rejects empty local extraction instead of returning successful empty content", async () => {
    await expect(
      createParser().parse({ name: "empty.md", buffer: Buffer.from(" \n\n") })
    ).rejects.toMatchObject({ code: "SOURCE_EMPTY" });
  });

  test("requires an explicitly configured OCR service for scanned formats", async () => {
    await expect(
      createParser().parse({ name: "scan.png", buffer: Buffer.from("image") })
    ).rejects.toMatchObject({ code: "PARSER_UNCONFIGURED" });
  });

  test("rejects OCR URLs outside the configured endpoint without echoing credentials", async () => {
    const secret = "synthetic-url-password";
    const fetchImpl = jest.fn();
    const parser = createParser({
      services: {
        ocr: { url: `https://synthetic-user:${secret}@ocr.example/parse` },
      },
      fetchImpl,
    });
    await expect(
      parser.parse({ name: "scan.png", buffer: Buffer.from("image") })
    ).rejects.toMatchObject({
      code: "PARSER_CONFIG_INVALID",
      message: expect.not.stringContaining(secret),
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    for (const url of [
      "https://ocr.example/service/parse",
      "https://ocr.example/parse/more",
    ]) {
      await expect(
        createParser({ services: { ocr: { url } }, fetchImpl }).parse({
          name: "scan.png",
          buffer: Buffer.from("image"),
        })
      ).rejects.toMatchObject({ code: "PARSER_CONFIG_INVALID" });
    }
    await expect(
      createParser({
        services: { ocr: { url: "https://ocr.example/parse/" } },
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            segments: [{ text: "OCR text", location: { type: "image" } }],
          }),
        }),
      }).parse({ name: "scan.png", buffer: Buffer.from("image") })
    ).resolves.toEqual([{ text: "OCR text", location: { type: "image" } }]);
  });

  test("validates located OCR service responses", async () => {
    const parser = createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          segments: [{ text: "Scanned decision", location: { type: "image" } }],
        }),
      }),
    });
    await expect(
      parser.parse({ name: "scan.png", buffer: Buffer.from("image") })
    ).resolves.toEqual([
      { text: "Scanned decision", location: { type: "image" } },
    ]);
  });

  test("OCRs textless pages in a mixed text and scanned PDF", async () => {
    const pdf = await PDFDocument.create();
    const pageOne = pdf.addPage();
    pageOne.drawText("Native PDF decision", {
      font: await pdf.embedFont(StandardFonts.Helvetica),
    });
    pdf.addPage();
    const buffer = Buffer.from(await pdf.save());
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        segments: [
          {
            text: "First scanned-page decision",
            location: { type: "page", page: 2 },
          },
          { text: "Scanned appendix", location: { type: "page", page: 2 } },
        ],
      }),
    }));
    const result = await createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl,
    }).parse({
      name: "mixed.pdf",
      buffer,
    });
    expect(result).toEqual([
      { text: "Native PDF decision", location: { type: "page", page: 1 } },
      {
        text: "First scanned-page decision",
        location: { type: "page", page: 2 },
      },
      { text: "Scanned appendix", location: { type: "page", page: 2 } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects OCR locations that do not match the uploaded format", async () => {
    const parser = createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          segments: [
            {
              text: "Wrong locator",
              location: { type: "paragraph", paragraph: 0 },
            },
          ],
        }),
      }),
    });
    await expect(
      parser.parse({ name: "scan.pdf", buffer: textPdf(" ") })
    ).rejects.toMatchObject({
      code: "PARSER_RESPONSE_INVALID",
    });
  });

  test("rejects malformed remote locations", async () => {
    const parser = createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ segments: [{ text: "No location" }] }),
      }),
    });
    await expect(
      parser.parse({ name: "scan.png", buffer: Buffer.from("image") })
    ).rejects.toMatchObject({ code: "PARSER_RESPONSE_INVALID" });
  });
});
