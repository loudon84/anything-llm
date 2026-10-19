const { createHash } = require("crypto");

function hashPageContent(document) {
  if (!document || typeof document.pageContent !== "string") {
    throw new Error("MGW_FORMAT_INVALID");
  }

  return createHash("sha256").update(document.pageContent, "utf8").digest("hex");
}

module.exports = { hashPageContent };
