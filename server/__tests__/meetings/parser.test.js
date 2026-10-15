const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const {
  createParser,
  isPdfImageOperator,
} = require("../../modules/meetings/parser");
const { createJobRunner } = require("../../modules/meetings/jobs");

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

function maskImagePdf() {
  const content =
    "BT /F1 12 Tf 40 700 Td (Native mask header) Tj ET\nq 300 0 0 500 40 100 cm /Stencil Do Q";
  const mask = Buffer.from([0xff, 0x81, 0xbd, 0xa5, 0xa5, 0xbd, 0x81, 0xff]);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Stencil 6 0 R >> >> /Contents 5 0 R >>"
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n`),
      Buffer.from(content),
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ImageMask true /BitsPerComponent 1 /Decode [0 1] /Length ${mask.length} >>\nstream\n`
      ),
      mask,
      Buffer.from("\nendstream"),
    ]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`);
    const suffix = Buffer.from("\nendobj\n");
    chunks.push(prefix, object, suffix);
    length += prefix.length + object.length + suffix.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
  ].join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref), Buffer.from(trailer));
  return Buffer.concat(chunks);
}

async function pdfPaintOperators(buffer) {
  const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
  const document = await pdfjs.getDocument({
    data: Uint8Array.from(buffer),
    nativeImageDecoderSupport: pdfjs.NativeImageDecoding.NONE,
  });
  try {
    const operators = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      operators.push(...(await page.getOperatorList()).fnArray);
    }
    return operators;
  } finally {
    await document.destroy();
  }
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
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/><Relationship Id="rId2" Target="slides/slide2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>',
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
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>',
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

  test.each([
    ["fetch headers", async () => new Promise(() => {})],
    ["response body", async () => ({ ok: true, json: () => new Promise(() => {}) })],
  ])("bounds OCR deadline while waiting for %s", async (_phase, fetchImpl) => {
    const buffer = zipBuffer({
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>',
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p"><p:pic><p:blipFill><a:blip xmlns:a="a" r:embed="rIdImage"/></p:blipFill></p:pic></p:sld>',
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image.png"/></Relationships>',
      "ppt/media/image.png": "image",
    });
    const controllerSignals = [];
    const parser = createParser({
      services: { ocr: { url: "http://parser.local/parse", timeoutMs: 10 } },
      fetchImpl: (url, options) => {
        controllerSignals.push(options.signal);
        return fetchImpl();
      },
    });

    await expect(parser.parse({ name: "stalled.pptx", buffer })).rejects.toMatchObject({
      code: "PARSER_TIMEOUT",
      status: 504,
    });
    expect(controllerSignals[0].aborted).toBe(true);
  });

  test("marks a timed-out OCR job failed and lets the next durable job run", async () => {
    const jobs = [
      { id: 1, kind: "OCR", status: "CREATED", attempts: 0, createdAt: new Date(1) },
      { id: 2, kind: "FOLLOW_UP", status: "CREATED", attempts: 0, createdAt: new Date(2) },
    ];
    const matches = (row, where = {}) =>
      Object.entries(where).every(([key, value]) => {
        if (value && typeof value === "object" && "in" in value)
          return value.in.includes(row[key]);
        if (value && typeof value === "object" && "lte" in value)
          return row[key] != null && new Date(row[key]) <= value.lte;
        return row[key] === value;
      });
    const prisma = {
      meeting_jobs: {
        findMany: async ({ where = {} }) =>
          jobs.filter((row) => matches(row, where)).sort((a, b) => a.id - b.id),
        findUnique: async ({ where }) => jobs.find((row) => row.id === where.id),
        updateMany: async ({ where, data }) => {
          const selected = jobs.filter((row) => matches(row, where));
          selected.forEach((row) => Object.assign(row, data));
          return { count: selected.length };
        },
      },
      $transaction: async (callback) => callback(prisma),
    };
    const timedOutPptx = zipBuffer({
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>',
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p"><p:pic><p:blipFill><a:blip xmlns:a="a" r:embed="rIdImage"/></p:blipFill></p:pic></p:sld>',
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image.png"/></Relationships>',
      "ppt/media/image.png": "image",
    });
    const parser = createParser({
      services: { ocr: { url: "http://parser.local/parse", timeoutMs: 10 } },
      fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }),
    });
    const completed = [];
    const runner = createJobRunner({
      prisma,
      handlers: {
        OCR: async () => parser.parse({ name: "stalled.pptx", buffer: timedOutPptx }),
        FOLLOW_UP: async () => completed.push("follow-up"),
      },
    });

    await expect(runner.runOnce()).rejects.toMatchObject({ code: "PARSER_TIMEOUT" });
    expect(jobs[0].status).toBe("FAILED");
    await expect(runner.runOnce()).resolves.toBe(true);
    expect(jobs[1].status).toBe("SUCCESS");
    expect(completed).toEqual(["follow-up"]);
  });

  test("uses presentation relationship order for native and OCR slide citations", async () => {
    const buffer = zipBuffer({
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/><Relationship Id="rId2" Target="slides/slide2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>',
      "ppt/slides/slide1.xml":
        '<p:sld xmlns:p="p"><a:t xmlns:a="a">Second displayed slide</a:t></p:sld>',
      "ppt/slides/slide2.xml":
        '<p:sld xmlns:p="p"><a:t xmlns:a="a">First displayed slide</a:t><p:pic><p:blipFill><a:blip xmlns:a="a" r:embed="rIdImage"/></p:blipFill></p:pic></p:sld>',
      "ppt/slides/_rels/slide2.xml.rels":
        '<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
      "ppt/media/image1.png": "fake-png-payload",
    });
    const segments = await createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          segments: [{ text: "OCR on first displayed slide", location: { type: "image" } }],
        }),
      }),
    }).parse({ name: "reordered.pptx", buffer });

    expect(
      Object.fromEntries(
        segments.map((segment) => [segment.text, segment.location.slide])
      )
    ).toEqual({
      "First displayed slide": 1,
      "OCR on first displayed slide": 1,
      "Second displayed slide": 2,
    });
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

  test("keeps the real PDF page number when extracting multiple pages", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("Actual page one", { font });
    pdf.addPage().drawText("Actual page two", { font });

    const segments = await createParser().parse({
      name: "numbered.pdf",
      buffer: Buffer.from(await pdf.save()),
    });

    expect(segments).toEqual([
      { text: "Actual page one", location: { type: "page", page: 1 } },
      { text: "Actual page two", location: { type: "page", page: 2 } },
    ]);
  });

  test("rejects the document when a later PDF page operator fails", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("First page must not publish alone", { font });
    pdf.addPage().drawText("Second page has a parse failure", { font });
    const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
    const originalGetDocument = pdfjs.getDocument;
    pdfjs.getDocument = (...args) => {
      const task = originalGetDocument(...args);
      return task.promise.then((document) => ({
        numPages: document.numPages,
        destroy: () => document.destroy(),
        getPage: async (number) => {
          const page = await document.getPage(number);
          if (number === 2)
            page.getOperatorList = async () => {
              throw new Error("synthetic page two operator failure");
            };
          return page;
        },
      }));
    };
    try {
      await expect(
        createParser().parse({
          name: "operator-failure.pdf",
          buffer: Buffer.from(await pdf.save()),
        })
      ).rejects.toMatchObject({ code: "SOURCE_PARSE_FAILED" });
    } finally {
      pdfjs.getDocument = originalGetDocument;
    }
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

  test("OCRs scanned images on a PDF page that also has native text", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    page.drawText("Native meeting header", {
      font: await pdf.embedFont(StandardFonts.Helvetica),
    });
    const scannedBody = await pdf.embedPng(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8uoAAAAASUVORK5CYII=",
        "base64"
      )
    );
    page.drawImage(scannedBody, {
      x: 40,
      y: 100,
      width: 300,
      height: 500,
    });
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        segments: [
          {
            text: "Scanned meeting decision",
            location: { type: "page", page: 1 },
          },
        ],
      }),
    }));

    const result = await createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl,
    }).parse({ name: "hybrid.pdf", buffer: Buffer.from(await pdf.save()) });

    expect(result).toEqual([
      { text: "Native meeting header", location: { type: "page", page: 1 } },
      { text: "Scanned meeting decision", location: { type: "page", page: 1 } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("OCRs a stencil-mask image on a native-text PDF page", async () => {
    const buffer = maskImagePdf();
    const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
    const operators = await pdfPaintOperators(buffer);
    expect(operators).toContain(pdfjs.OPS.paintImageMaskXObject);

    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        segments: [
          {
            text: "Scanned stencil-mask body",
            location: { type: "page", page: 1 },
          },
        ],
      }),
    }));
    const result = await createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl,
    }).parse({ name: "mask.pdf", buffer });

    expect(result).toEqual([
      { text: "Native mask header", location: { type: "page", page: 1 } },
      {
        text: "Scanned stencil-mask body",
        location: { type: "page", page: 1 },
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("recognizes each image paint operator exposed by the bundled PDF.js", () => {
    const { OPS } = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
    for (const name of [
      "paintImageMaskXObject",
      "paintImageMaskXObjectGroup",
      "paintImageMaskXObjectRepeat",
      "paintImageXObject",
      "paintImageXObjectRepeat",
      "paintInlineImageXObject",
      "paintInlineImageXObjectGroup",
      "paintJpegXObject",
    ]) {
      expect(OPS[name]).toBeDefined();
      expect(isPdfImageOperator(OPS[name], OPS)).toBe(true);
    }
  });

  test("OCRs native-text PDF pages with the bundled PDF.js JPEG paint operator", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    page.drawText("Native JPEG header", {
      font: await pdf.embedFont(StandardFonts.Helvetica),
    });
    const jpeg = await pdf.embedJpg(
      Uint8Array.from(
        fs.readFileSync(
          path.join(__dirname, "fixtures", "meeting-jpeg-xobject.jpg")
        )
      )
    );
    page.drawImage(jpeg, { x: 40, y: 100, width: 200, height: 100 });
    const buffer = Buffer.from(await pdf.save());
    const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
    const operators = await pdfPaintOperators(buffer);
    expect(
      operators.some((operator) => isPdfImageOperator(operator, pdfjs.OPS))
    ).toBe(true);
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        segments: [
          {
            text: "Scanned JPEG body",
            location: { type: "page", page: 1 },
          },
        ],
      }),
    }));

    const result = await createParser({
      services: { ocr: { url: "http://parser.local/parse" } },
      fetchImpl,
    }).parse({ name: "jpeg.pdf", buffer });

    expect(result).toEqual([
      { text: "Native JPEG header", location: { type: "page", page: 1 } },
      { text: "Scanned JPEG body", location: { type: "page", page: 1 } },
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
