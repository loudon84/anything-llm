import test from "node:test";
import assert from "node:assert/strict";
import {
  getMeetingSelectionState,
  canSupplementSource,
  getCitationLocationLabel,
  getDateBounds,
} from "./meetingRules.js";

test("auto-selected over-limit and unavailable meetings stay deselectable", () => {
  const meetings = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    retrievalStatus: index === 10 ? "WAITING_CONTENT" : "AVAILABLE",
  }));
  let selected = new Set(meetings.map(({ id }) => id));
  for (let id = 1; id <= 11; id += 1) selected.delete(id);

  const state = getMeetingSelectionState(meetings, selected);
  assert.equal(state.count, 9);
  assert.equal(state.canStart, true);
  assert.deepEqual(state.unavailableIds, []);
});

test("only active supplemental sources on drafts can be deleted", () => {
  const draft = { reviewStatus: "DRAFT" };
  assert.equal(
    canSupplementSource(draft, { sourceType: "SUPPLEMENT_FILE" }),
    true
  );
  assert.equal(
    canSupplementSource(draft, { sourceType: "TENCENT_ORIGINAL" }),
    false
  );
  assert.equal(
    canSupplementSource(
      { reviewStatus: "APPROVED" },
      { sourceType: "SUPPLEMENT_TEXT" }
    ),
    false
  );
  assert.equal(
    canSupplementSource(draft, {
      sourceType: "SUPPLEMENT_TEXT",
      deletedAt: "2026-10-01",
    }),
    false
  );
});

test("citation locations use available provenance and state when it is missing", () => {
  assert.equal(getCitationLocationLabel({ paragraph: 4 }), "第 4 段");
  assert.equal(getCitationLocationLabel({ page: 7 }), "第 7 页");
  assert.equal(getCitationLocationLabel({ cell: "B3" }), "单元格 B3");
  assert.equal(getCitationLocationLabel({ startMs: 12_400 }), "转写 12 秒");
  assert.equal(getCitationLocationLabel({}), "未提供精确位置");
});

test("selection start stays blocked with explicit reasons above ten or unavailable", () => {
  const meetings = [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      retrievalStatus: "AVAILABLE",
    })),
    { id: 11, retrievalStatus: "WAITING_CONTENT" },
  ];
  const tooMany = getMeetingSelectionState(
    meetings,
    new Set(meetings.map(({ id }) => id))
  );
  assert.equal(tooMany.canStart, false);
  assert.equal(tooMany.overLimit, true);
  assert.deepEqual(tooMany.unavailableIds, [11]);

  const onlyUnavailable = getMeetingSelectionState(meetings, new Set([11]));
  assert.equal(onlyUnavailable.canStart, false);
  assert.equal(onlyUnavailable.overLimit, false);
  assert.deepEqual(onlyUnavailable.unavailableIds, [11]);
});

test("date bounds use China time, include the chosen end date, and reject reversed ranges", () => {
  const bounds = getDateBounds("2026-10-01", "2026-10-02");
  assert.equal(bounds.from, "2026-09-30T16:00:00.000Z");
  assert.equal(bounds.to, "2026-10-02T16:00:00.000Z");
  assert.throws(() => getDateBounds("2026-10-03", "2026-10-02"), /结束日期/);
});
