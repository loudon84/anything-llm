const { LIMITS, REVIEW, RETRIEVAL } = require("./constants");
const { MeetingError } = require("./errors");

function shanghaiParts(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new MeetingError("A valid date is required", "INVALID_DATE");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "numeric",
  }).formatToParts(value);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, Number(part)]));
}

function quarterFor(date) {
  const { year, month } = shanghaiParts(date);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function validateScope(scope = {}) {
  const ids = Array.isArray(scope) ? scope : (scope.meetingIds || scope.meetings || []);
  const uniqueIds = new Set(ids.map((meeting) => typeof meeting === "object" ? meeting.id : meeting));
  if (uniqueIds.size > LIMITS.selectedMeetings) {
    throw new MeetingError("Select no more than ten meetings", "MEETING_SCOPE_LIMIT");
  }

  let duration = scope.durationMs;
  const from = scope.from || scope.startTime;
  const to = scope.to || scope.endTime;
  if (duration == null && from != null && to != null) duration = new Date(to).getTime() - new Date(from).getTime();
  if (duration != null && (!Number.isFinite(Number(duration)) || Number(duration) < 0)) {
    throw new MeetingError("A valid transcript time interval is required", "INVALID_TRANSCRIPT_SCOPE");
  }
  if (duration > LIMITS.transcriptDurationMs) {
    throw new MeetingError("Transcript selection cannot exceed three hours", "TRANSCRIPT_SCOPE_LIMIT");
  }
  return scope;
}

function assertQueryable(meetings) {
  const unavailable = (meetings || []).filter((meeting) => meeting.retrievalStatus !== RETRIEVAL.AVAILABLE);
  if (unavailable.length) {
    throw new MeetingError("Every selected meeting must be available before querying", "MEETING_UNAVAILABLE", 409);
  }
  return meetings;
}

function assertSourceDeletion(meeting, source) {
  if (source.sourceType === "TENCENT_ORIGINAL") {
    throw new MeetingError("Original meeting sources cannot be deleted", "SOURCE_IMMUTABLE", 409);
  }
  if (source.sourceType === "SUPPLEMENT_FILE" && meeting.reviewStatus !== REVIEW.DRAFT) {
    throw new MeetingError("File supplements can only be deleted from a draft", "SOURCE_IMMUTABLE", 409);
  }
  if (!["SUPPLEMENT_FILE", "SUPPLEMENT_TEXT"].includes(source.sourceType)) {
    throw new MeetingError("Only supplemental sources can be deleted", "SOURCE_IMMUTABLE", 409);
  }
  return true;
}

function assertFileLimits(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  const files = [...current.filter((file) => !file.deletedAt), ...additions];
  if (additions.some((file) => Number(file.bytes || 0) > LIMITS.fileBytes)) {
    throw new MeetingError("Each file must be 100 MB or smaller", "FILE_SIZE_LIMIT", 413);
  }
  if (files.length > LIMITS.filesPerMeeting) {
    throw new MeetingError("A meeting can have no more than 20 active files", "MEETING_FILE_COUNT_LIMIT", 413);
  }
  if (files.reduce((sum, file) => sum + Number(file.bytes || 0), 0) > LIMITS.meetingBytes) {
    throw new MeetingError("A meeting can contain no more than 500 MB of files", "MEETING_SIZE_LIMIT", 413);
  }
  return true;
}

module.exports = {
  LIMITS,
  REVIEW,
  RETRIEVAL,
  quarterFor,
  validateScope,
  assertQueryable,
  assertSourceDeletion,
  assertFileLimits,
};
