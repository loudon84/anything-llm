const path = require("path");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const { MeetingError } = require("./errors");

const LOCATION_TYPES = new Set([
  "paragraph",
  "page",
  "image",
  "cell",
  "slide",
  "transcript",
]);
const SUPPORTED = new Set([
  ".docx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".xlsx",
  ".pptx",
  ".md",
  ".txt",
]);

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(xml) {
  return [
    ...xml.matchAll(
      /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g
    ),
  ]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function segmentsForText(text) {
  return String(text)
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, paragraph) => ({
      text: line,
      location: { type: "paragraph", paragraph },
    }));
}

function validLocation(location) {
  if (
    !location ||
    typeof location !== "object" ||
    !LOCATION_TYPES.has(location.type)
  )
    return false;
  const nonnegative = ["paragraph", "page", "slide", "startMs", "endMs"];
  if (
    nonnegative.some(
      (field) =>
        location[field] !== undefined &&
        (!Number.isFinite(location[field]) || location[field] < 0)
    )
  )
    return false;
  if (location.type === "paragraph" && !Number.isInteger(location.paragraph))
    return false;
  if (
    location.type === "page" &&
    (!Number.isInteger(location.page) || location.page < 1)
  )
    return false;
  if (
    location.type === "slide" &&
    (!Number.isInteger(location.slide) || location.slide < 1)
  )
    return false;
  if (location.type === "cell" && (!location.sheet || !location.cell))
    return false;
  if (
    location.type === "transcript" &&
    (location.startMs === undefined ||
      location.endMs === undefined ||
      location.endMs < location.startMs)
  )
    return false;
  if (
    location.recordFileId !== undefined &&
    typeof location.recordFileId !== "string"
  )
    return false;
  return true;
}

function validateSegments(segments) {
  if (!Array.isArray(segments))
    throw new MeetingError(
      "Parser response must contain a segments array",
      "PARSER_RESPONSE_INVALID"
    );
  const clean = segments
    .map((segment) => ({
      text: typeof segment?.text === "string" ? segment.text.trim() : "",
      location: segment?.location,
    }))
    .filter((segment) => segment.text);
  if (clean.some((segment) => !validLocation(segment.location))) {
    throw new MeetingError(
      "Parser returned a segment without a valid source location",
      "PARSER_RESPONSE_INVALID"
    );
  }
  if (!clean.length)
    throw new MeetingError(
      "No readable content was found in the source",
      "SOURCE_EMPTY"
    );
  return clean;
}

function officeParagraphs(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("word/document.xml");
  if (!entry)
    throw new MeetingError(
      "DOCX document content is missing",
      "SOURCE_PARSE_FAILED"
    );
  return entry
    .getData()
    .toString("utf8")
    .split(/<(?:[A-Za-z0-9_]+:)?p(?:\s[^>]*)?>/)
    .slice(1)
    .map((paragraph) =>
      xmlText(paragraph.split(/<\/(?:[A-Za-z0-9_]+:)?p>/)[0]).trim()
    )
    .filter(Boolean)
    .map((text, paragraph) => ({
      text,
      location: { type: "paragraph", paragraph },
    }));
}

function pptxSlides(buffer) {
  const zip = new AdmZip(buffer);
  const names = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1])
    );
  return names.flatMap((name) => {
    const slide = Number(name.match(/slide(\d+)/)[1]);
    const text = xmlText(zip.readAsText(name)).trim();
    return text ? [{ text, location: { type: "slide", slide } }] : [];
  });
}

async function spreadsheetCells(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const segments = [];
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row, rowNumber) =>
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const value = cell.text?.trim();
        if (value)
          segments.push({
            text: value,
            location: {
              type: "cell",
              sheet: sheet.name,
              cell: cell.address || `${rowNumber}:${columnNumber}`,
            },
          });
      })
    )
  );
  return segments;
}

async function pdfPages(buffer) {
  let pdfParse;
  try {
    pdfParse = require("pdf-parse");
  } catch {
    return null;
  }
  const pages = [];
  try {
    await pdfParse(Uint8Array.from(buffer), {
      pagerender: async (page) => {
        const content = await page.getTextContent({
          normalizeWhitespace: true,
        });
        const text = content.items
          .map((item) => item.str)
          .join(" ")
          .trim();
        pages.push(text);
        return text;
      },
    });
  } catch (error) {
    throw new MeetingError(
      `PDF parsing failed: ${error.message}`,
      "SOURCE_PARSE_FAILED",
      422
    );
  }
  return pages
    .map((text, index) => ({
      text,
      location: { type: "page", page: index + 1 },
    }))
    .filter((item) => item.text);
}

function createParser({ services = {}, fetchImpl = global.fetch } = {}) {
  async function parseRemote(name, buffer) {
    const config = services.ocr;
    if (!config?.url)
      throw new MeetingError(
        "OCR/document parser service is not configured",
        "PARSER_UNCONFIGURED",
        503
      );
    let endpoint;
    try {
      endpoint = new URL(config.url);
    } catch {
      throw new MeetingError(
        "OCR/document parser URL is invalid",
        "PARSER_CONFIG_INVALID",
        500
      );
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.pathname.replace(/\/$/, "") !== "/parse"
    ) {
      throw new MeetingError(
        "OCR/document parser URL must be an HTTP(S) /parse endpoint",
        "PARSER_CONFIG_INVALID",
        500
      );
    }
    if (typeof fetchImpl !== "function")
      throw new MeetingError(
        "HTTP fetch is unavailable for OCR/document parsing",
        "PARSER_UNCONFIGURED",
        503
      );
    const form = new FormData();
    form.append("file", new Blob([buffer]), path.basename(name));
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: config.token
          ? { Authorization: `Bearer ${config.token}` }
          : {},
        body: form,
      });
    } catch (error) {
      throw new MeetingError(
        `OCR/document parser request failed: ${error.message}`,
        "PARSER_SERVICE_FAILED",
        502
      );
    }
    if (!response?.ok)
      throw new MeetingError(
        `OCR/document parser returned HTTP ${response?.status || "error"}`,
        "PARSER_SERVICE_FAILED",
        502
      );
    let body;
    try {
      body = await response.json();
    } catch {
      throw new MeetingError(
        "OCR/document parser returned invalid JSON",
        "PARSER_RESPONSE_INVALID",
        502
      );
    }
    return validateSegments(body?.segments);
  }

  return {
    async parse({ name, buffer }) {
      if (typeof name !== "string" || !Buffer.isBuffer(buffer))
        throw new MeetingError(
          "A source name and Buffer are required",
          "SOURCE_INPUT_INVALID"
        );
      const extension = path.extname(name).toLowerCase();
      if (!SUPPORTED.has(extension))
        throw new MeetingError(
          `Unsupported source format: ${extension || "unknown"}`,
          "SOURCE_FORMAT_UNSUPPORTED"
        );
      let segments;
      if ([".txt", ".md"].includes(extension))
        segments = segmentsForText(buffer.toString("utf8"));
      else if (extension === ".docx") segments = officeParagraphs(buffer);
      else if (extension === ".pptx") segments = pptxSlides(buffer);
      else if (extension === ".xlsx") segments = await spreadsheetCells(buffer);
      else if (extension === ".pdf") {
        segments = await pdfPages(buffer);
        if (!segments?.length) return parseRemote(name, buffer);
      } else return parseRemote(name, buffer);
      return validateSegments(segments || []);
    },
  };
}

module.exports = { createParser, validateSegments };
