const {
  LIMITS,
  REVIEW,
  RETRIEVAL,
  quarterFor,
  validateScope,
  assertQueryable,
  assertSourceDeletion,
  assertFileLimits,
} = require("../../modules/meetings/policy");

describe("meeting lifecycle policies", () => {
  test("assigns quarters in the Asia/Shanghai business timezone", () => {
    expect(quarterFor(new Date("2026-03-31T16:30:00.000Z"))).toBe("2026-Q2");
  });

  test("rejects the 201st active meeting in a quarter", () => {
    expect(LIMITS.meetingsPerQuarter).toBe(200);
  });

  test("rejects scopes containing more than ten selected meetings", () => {
    expect(() => validateScope({ meetingIds: Array.from({ length: 11 }, (_, i) => i + 1) }))
      .toThrow(expect.objectContaining({ code: "MEETING_SCOPE_LIMIT" }));
  });

  test("rejects transcript scopes longer than three hours", () => {
    expect(() => validateScope({ durationMs: 3 * 60 * 60 * 1000 + 1 }))
      .toThrow(expect.objectContaining({ code: "TRANSCRIPT_SCOPE_LIMIT" }));
  });

  test("rejects file and meeting byte/count limits", () => {
    expect(() => assertFileLimits([], { name: "large", bytes: 100_000_001 }))
      .toThrow(expect.objectContaining({ code: "FILE_SIZE_LIMIT" }));
    expect(() => assertFileLimits(Array.from({ length: 20 }, () => ({ bytes: 1 })), { name: "one-more", bytes: 1 }))
      .toThrow(expect.objectContaining({ code: "MEETING_FILE_COUNT_LIMIT" }));
    expect(() => assertFileLimits([{ bytes: 500_000_000 }], { name: "too-big", bytes: 1 }))
      .toThrow(expect.objectContaining({ code: "MEETING_SIZE_LIMIT" }));
  });

  test("blocks query unless every selected meeting is available", () => {
    expect(() => assertQueryable([
      { id: 1, retrievalStatus: RETRIEVAL.AVAILABLE },
      { id: 2, retrievalStatus: RETRIEVAL.WAITING_CONTENT },
    ])).toThrow(expect.objectContaining({ code: "MEETING_UNAVAILABLE" }));
  });

  test("prevents deletion of original and approved supplemental sources", () => {
    expect(() => assertSourceDeletion(
      { reviewStatus: REVIEW.DRAFT },
      { sourceType: "TENCENT_ORIGINAL" },
    )).toThrow(expect.objectContaining({ code: "SOURCE_IMMUTABLE" }));
    expect(() => assertSourceDeletion(
      { reviewStatus: REVIEW.APPROVED },
      { sourceType: "SUPPLEMENT_FILE" },
    )).toThrow(expect.objectContaining({ code: "SOURCE_IMMUTABLE" }));
  });
});
