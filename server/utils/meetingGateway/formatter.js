const { createHash } = require("crypto");

const FORMATTER_VERSION = "v1";
const REQUIRED_METADATA = [
  "gatewayMeetingId",
  "gatewayRecordingId",
  "gatewayAssetId",
  "sourceVersion",
  "source",
  "anythingUserId",
  "gatewayMemberId",
  "connectionRef",
  "timestamp",
  "contentSha256",
];
const MARKDOWN_SPECIAL = /([\\`*_{}\[\]()#+\-.!|>~])/g;

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

function escapePlainText(value) {
  return normalizeLineEndings(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(MARKDOWN_SPECIAL, "\\$1");
}

function singleLine(value) {
  return escapePlainText(value).replace(/\n/g, " ");
}

function validateInput(input) {
  if (
    !input ||
    !["transcript", "minutes"].includes(input.contentType) ||
    typeof input.sourceContent !== "string" ||
    !input.metadata ||
    typeof input.metadata !== "object" ||
    Array.isArray(input.metadata)
  ) {
    throw new Error("MGW_FORMAT_INVALID");
  }

  for (const field of REQUIRED_METADATA) {
    if (typeof input.metadata[field] !== "string" || !input.metadata[field].trim()) {
      throw new Error("MGW_FORMAT_INVALID");
    }
  }

  if (!/^[a-f0-9]{64}$/.test(input.metadata.contentSha256)) {
    throw new Error("MGW_FORMAT_INVALID");
  }

  // Require an explicit timezone so formatting never depends on the host's local timezone.
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.metadata.timestamp)) {
    throw new Error("MGW_FORMAT_INVALID");
  }

  const timestamp = new Date(input.metadata.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new Error("MGW_FORMAT_INVALID");
  return timestamp.toISOString();
}

function formatContent(input) {
  const timestampUtc = validateInput(input);
  const metadata = input.metadata;
  const title = input.contentType === "transcript" ? "Transcript" : "Minutes";
  const lines = [
    `# ${title}`,
    `- Gateway meeting ID: ${singleLine(metadata.gatewayMeetingId)}`,
    `- Gateway recording ID: ${singleLine(metadata.gatewayRecordingId)}`,
    `- Gateway asset ID: ${singleLine(metadata.gatewayAssetId)}`,
    `- Content version: ${singleLine(metadata.sourceVersion)}`,
    `- Source: ${singleLine(metadata.source)}`,
    `- AnythingLLM user ID: ${singleLine(metadata.anythingUserId)}`,
    `- Gateway member ID: ${singleLine(metadata.gatewayMemberId)}`,
    `- Connection reference: ${singleLine(metadata.connectionRef)}`,
    `- UTC timestamp: ${timestampUtc}`,
    `- Content SHA-256: ${metadata.contentSha256}`,
    "",
    "## Content",
    "",
    escapePlainText(input.sourceContent),
  ];
  const markdown = normalizeLineEndings(lines.join("\n"));
  const markdownSha256 = createHash("sha256").update(markdown, "utf8").digest("hex");

  return { markdown, formatterVersion: FORMATTER_VERSION, markdownSha256 };
}

module.exports = { FORMATTER_VERSION, formatContent };
