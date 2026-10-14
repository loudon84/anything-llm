const LIMITS = Object.freeze({
  meetingsPerQuarter: 200,
  selectedMeetings: 10,
  transcriptDurationMs: 3 * 60 * 60 * 1000,
  fileBytes: 100_000_000,
  filesPerMeeting: 20,
  meetingBytes: 500_000_000,
});

const REVIEW = Object.freeze({ DRAFT: "DRAFT", APPROVED: "APPROVED" });
const RETRIEVAL = Object.freeze({
  WAITING_CONTENT: "WAITING_CONTENT",
  AVAILABLE: "AVAILABLE",
  INDEXING: "INDEXING",
  INDEX_FAILED: "INDEX_FAILED",
  DELETED: "DELETED",
});

module.exports = { LIMITS, REVIEW, RETRIEVAL };
