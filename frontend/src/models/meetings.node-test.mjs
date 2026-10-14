import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { StaticRouter } from "react-router-dom/server.js";
import {
  getMeetingSelectionState,
  getActiveFileUsage,
  getSourceTypeLabel,
  getLocationTypeLabel,
  getMeetingSourceState,
  getSourcePreviewMode,
  canSupplementSource,
  getCitationLocationLabel,
  getDateBounds,
  getRemoteMeetingPage,
  validateMeetingImport,
  getMeetingActionCapabilities,
  canDeleteSupplement,
  compareCitedSource,
  getReanswerDraft,
  getMeetingDraftValues,
  getUploadBatchFeedback,
  getPollingListParams,
  getPollingRefreshError,
  getWorkspaceCitationSnapshot,
} from "./meetingRules.js";

test("attachment quota excludes supplemental text and archived sources", () => {
  assert.deepEqual(
    getActiveFileUsage([
      { sourceType: "TENCENT_ORIGINAL", bytes: 499_999_999 },
      { sourceType: "SUPPLEMENT_TEXT", bytes: 50_000_000 },
      { sourceType: "SUPPLEMENT_FILE", bytes: 1 },
      { sourceType: "SUPPLEMENT_FILE", bytes: 80, deletedAt: "2026-10-01" },
    ]),
    { fileCount: 2, bytes: 500_000_000 }
  );
  assert.equal(getSourceTypeLabel("SUPPLEMENT_FILE"), "用户补充文件");
  assert.equal(getSourceTypeLabel("SUPPLEMENT_TEXT"), "用户补充文本");
  assert.equal(getLocationTypeLabel("paragraph"), "段落");
  assert.equal(
    getMeetingSourceState(null, { sourceType: "SUPPLEMENT_FILE" }),
    "current"
  );
  assert.equal(
    getMeetingSourceState(
      { citedSource: { contentHash: "saved" } },
      { contentHash: "current" }
    ),
    "modified"
  );
  assert.equal(getSourcePreviewMode({ name: "source.txt" }), "text");
  assert.equal(
    getSourcePreviewMode({ name: "source.html" }, "text/html"),
    "text"
  );
  assert.equal(
    getSourcePreviewMode({ name: "source.svg" }, "image/svg+xml"),
    "text"
  );
  assert.equal(
    getSourcePreviewMode({ name: "source.pdf" }, "application/pdf"),
    "embedded"
  );
  assert.equal(getSourcePreviewMode({ name: "source.pdf" }), "embedded");
  assert.equal(
    getSourcePreviewMode({ name: "source.png" }, "image/png"),
    "embedded"
  );
  assert.equal(getSourcePreviewMode({ name: "source.docx" }), "download-only");
  assert.equal(
    getSourcePreviewMode({ name: "unknown" }, "application/octet-stream"),
    "download-only"
  );
});

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

test("supplement file deletion is draft-only while text deletion returns approved meetings to draft", () => {
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
    canDeleteSupplement(
      { reviewStatus: "APPROVED" },
      { sourceType: "SUPPLEMENT_TEXT" }
    ),
    true
  );
  assert.equal(
    canSupplementSource(draft, {
      sourceType: "SUPPLEMENT_TEXT",
      deletedAt: "2026-10-01",
    }),
    false
  );
});

test("remote API page unwraps the actual meetings.items and nextCursor envelope", () => {
  assert.deepEqual(
    getRemoteMeetingPage({
      meetings: { items: [{ externalId: "m1" }], nextCursor: "2" },
    }),
    { items: [{ externalId: "m1" }], nextCursor: "2" }
  );
  assert.throws(() => getRemoteMeetingPage({ meetings: [] }), /无效响应/);
});

test("approved meeting action matrix allows revisions and new files but not deleting files", () => {
  assert.deepEqual(
    getMeetingActionCapabilities({
      reviewStatus: "APPROVED",
      retrievalStatus: "AVAILABLE",
    }),
    {
      editContent: true,
      addSupplementText: true,
      addSupplementFile: true,
      approve: false,
      deleteMeeting: false,
    }
  );
  assert.equal(
    canDeleteSupplement(
      { reviewStatus: "APPROVED" },
      { sourceType: "SUPPLEMENT_TEXT" }
    ),
    true
  );
  assert.equal(
    canDeleteSupplement(
      { reviewStatus: "APPROVED" },
      { sourceType: "SUPPLEMENT_FILE" }
    ),
    false
  );
});

test("metadata-only imports omit transcript offsets and preserve discovery date scope", () => {
  const result = validateMeetingImport({
    manifest: {
      transcriptDurationMs: 0,
      capabilities: { transcript: { status: "absent" } },
    },
    attachments: [{ externalFileId: "f1", bytes: 4 }],
    discoveryStart: "2026-10-01T00:00:00.000Z",
    discoveryEnd: "2026-10-02T00:00:00.000Z",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.scope, {
    startTime: "2026-10-01T00:00:00.000Z",
    endTime: "2026-10-02T00:00:00.000Z",
    attachmentIds: ["f1"],
  });
});

test("import attachment and selected transcript limits are checked before submission", () => {
  const result = validateMeetingImport({
    manifest: {
      transcriptDurationMs: 3 * 60 * 60 * 1000 + 1,
      capabilities: { transcript: { status: "supported" } },
    },
    attachments: [{ externalFileId: "f1", bytes: 100_000_001 }],
    discoveryStart: "2026-10-01T00:00:00.000Z",
    discoveryEnd: "2026-10-02T00:00:00.000Z",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("100 MB")));
  assert.ok(result.errors.some((message) => message.includes("3 小时")));
  const overLimit = validateMeetingImport({
    manifest: { capabilities: { transcript: { status: "unsupported" } } },
    attachments: Array.from({ length: 6 }, (_, index) => ({
      externalFileId: `f${index}`,
      bytes: 100_000_000,
    })),
    discoveryStart: "2026-10-01T00:00:00.000Z",
    discoveryEnd: "2026-10-02T00:00:00.000Z",
  });
  assert.ok(overLimit.errors.some((message) => message.includes("500 MB")));
  const tooManyAttachments = validateMeetingImport({
    manifest: { capabilities: { transcript: { status: "unsupported" } } },
    attachments: Array.from({ length: 21 }, (_, index) => ({
      externalFileId: `f${index}`,
      bytes: 1,
    })),
    discoveryStart: "2026-10-01T00:00:00.000Z",
    discoveryEnd: "2026-10-02T00:00:00.000Z",
  });
  assert.ok(
    tooManyAttachments.errors.some((message) => message.includes("20 个附件"))
  );
});

test("transcript selection accepts an end-only range from zero but rejects an open end", () => {
  const base = {
    manifest: {
      transcriptDurationMs: 2 * 60 * 60 * 1000,
      capabilities: { transcript: { status: "supported" } },
    },
    discoveryStart: "2026-10-01T00:00:00.000Z",
    discoveryEnd: "2026-10-02T00:00:00.000Z",
  };
  const fromZero = validateMeetingImport({ ...base, to: "3600000" });
  assert.equal(fromZero.valid, true);
  assert.deepEqual(fromZero.scope, {
    startTime: base.discoveryStart,
    endTime: base.discoveryEnd,
    to: 3_600_000,
    attachmentIds: [],
  });
  assert.equal(validateMeetingImport({ ...base, from: "1000" }).valid, false);
});

test("citation state distinguishes changed and deleted originals from saved snapshots", () => {
  const citation = { contentHash: "a", activeHash: "a", updatedAt: "t1" };
  assert.equal(compareCitedSource(citation, { ...citation }), "unchanged");
  assert.equal(
    compareCitedSource(citation, { ...citation, contentHash: "b" }),
    "modified"
  );
  assert.equal(
    compareCitedSource(citation, { ...citation, deletedAt: "t2" }),
    "deleted"
  );
});

test("latest-answer reanswer control restores that answer's question and clarification", () => {
  assert.deepEqual(
    getReanswerDraft({ id: 7, question: "Q", clarification: "C" }),
    {
      reanswerId: "7",
      question: "Q",
      clarification: "C",
    }
  );
});

test("coverage object renders as ordinary React text instead of an invalid object child", async () => {
  const vite = await createServer({
    configFile: "vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { CoverageBadge } = await vite.ssrLoadModule(
      "/src/pages/Meetings/MeetingsUI.jsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(CoverageBadge, {
        coverage: {
          transcript: { status: "supported" },
          attachments: { status: "absent" },
        },
      })
    );
    assert.match(html, /转写: supported/);
    assert.match(html, /附件: absent/);
  } finally {
    await vite.close();
  }
});

test("actual meeting citation renders object-shaped coverage with resolved meeting provenance", async () => {
  const vite = await createServer({
    configFile: "vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { Citation } = await vite.ssrLoadModule(
      "/src/pages/Meetings/Conversation.jsx"
    );
    const citation = {
      id: 5,
      meetingId: 12,
      sourceId: 5,
      sourceType: "SUMMARY",
      name: "会议摘要",
      quote: "决定于周五完成",
      location: { paragraph: 2 },
      reviewStatus: "APPROVED",
      coverage: { transcript: { status: "supported" } },
    };
    const html = renderToStaticMarkup(
      React.createElement(
        StaticRouter,
        { location: "/meetings/conversations/1" },
        React.createElement(Citation, {
          citation,
          meeting: {
            id: 12,
            title: "项目周会",
            startTime: "2026-10-14T01:00:00.000Z",
          },
          answer: {
            sourceState: {
              citedSources: [{ meetingId: 12, id: 5, contentHash: "a" }],
            },
          },
        })
      )
    );
    assert.match(html, /项目周会/);
    assert.match(html, /转写: supported/);
    assert.match(html, /决定于周五完成/);
  } finally {
    await vite.close();
  }
});

test("meeting answer history consumes the API array envelope and rejects malformed history", async () => {
  const vite = await createServer({
    configFile: "vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  try {
    const { Meetings } = await vite.ssrLoadModule("/src/models/meetings.js");
    globalThis.window = { localStorage: { getItem: () => null } };
    const answer = { id: 8, status: "ANSWERED", citations: [] };
    let responseBody = {
      conversation: {
        id: 4,
        meetingIds: [1],
        workspaceIds: [],
        scopeState: { available: false, blockedReason: "WAITING_CONTENT" },
      },
      answers: [answer],
    };
    globalThis.fetch = async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    assert.deepEqual(await Meetings.answers(4), [answer]);

    responseBody = {
      answers: {
        conversation: { scopeState: { available: false } },
        answers: [answer],
      },
    };
    await assert.rejects(Meetings.answers(4), /无效的历史回答/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    await vite.close();
  }
});

test("background meeting refresh keeps the user's unsaved content edits", () => {
  assert.deepEqual(
    getMeetingDraftValues(
      { summary: "typing", transcript: "unsaved" },
      { summary: "old saved", transcript: "old saved transcript" },
      true
    ),
    { summary: "typing", transcript: "unsaved" }
  );
});

test("upload feedback retains rejection after refresh and reports partial batch success", () => {
  assert.deepEqual(getUploadBatchFeedback(1, 3, "后续文件失败"), {
    error: "后续文件失败",
    notice: "已成功提交 1/3 个文件；失败项可单独重试上传。",
  });
  assert.deepEqual(getUploadBatchFeedback(3, 3, ""), {
    error: "",
    notice: "已提交 3 个补充文件，解析任务将在后台继续。",
  });
});

test("background detail polling preserves an upload error through success and failure until a user refresh", () => {
  let error = "后续文件失败";
  error = getPollingRefreshError(error, "", true);
  assert.equal(error, "后续文件失败");
  error = getPollingRefreshError(error, "轮询暂时失败", true);
  assert.equal(error, "后续文件失败");
  error = getPollingRefreshError(error, "", false);
  assert.equal(error, "");
});

test("Workspace citation route payload retains its saved revision and answer freshness", () => {
  assert.deepEqual(
    getWorkspaceCitationSnapshot({
      quote: "已保存的回答摘录",
      sourceName: "需求说明.pdf",
      location: { page: 4 },
      citedSource: {
        sourceType: "WORKSPACE",
        workspaceId: 6,
        documentId: "doc-9",
        revision: "saved-sha256-revision",
      },
      freshness: { stale: true, newSources: false },
    }),
    {
      quote: "已保存的回答摘录",
      sourceName: "需求说明.pdf",
      location: { page: 4 },
      citedSource: {
        sourceType: "WORKSPACE",
        workspaceId: 6,
        documentId: "doc-9",
        revision: "saved-sha256-revision",
      },
      freshness: { stale: true, newSources: false },
    }
  );
});

test("Workspace viewer labels saved revision and current availability without inferring per-file change from answer freshness", async () => {
  const vite = await createServer({
    configFile: "vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { WorkspaceSourceStatus } = await vite.ssrLoadModule(
      "/src/pages/Meetings/SourceViewer.jsx"
    );
    const snapshot = {
      citedSource: { revision: "saved-sha256-revision" },
      freshness: { stale: true, newSources: false },
    };
    const available = renderToStaticMarkup(
      React.createElement(WorkspaceSourceStatus, {
        snapshot,
        availability: "available",
      })
    );
    assert.match(available, /saved-sha256-revision/);
    assert.match(available, /当前工作区原件可读取/);
    assert.match(available, /无法比较当前文件版本/);
    assert.match(available, /不能说明这份工作区文件发生了变化/);
    assert.doesNotMatch(available, /当前工作区原件与回答时一致/);

    const unavailable = renderToStaticMarkup(
      React.createElement(WorkspaceSourceStatus, {
        snapshot,
        availability: "unavailable",
      })
    );
    assert.match(unavailable, /不可读取或权限已变化/);
    assert.doesNotMatch(unavailable, /文档已删除/);
  } finally {
    await vite.close();
  }
});

test("current text preview shows file text as escaped React content", async () => {
  const vite = await createServer({
    configFile: "vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { SourceTextPreview } = await vite.ssrLoadModule(
      "/src/pages/Meetings/SourceViewer.jsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(SourceTextPreview, {
        text: "Original file text\n<script>do not execute</script>",
      })
    );
    assert.match(html, /Original file text/);
    assert.match(html, /&lt;script&gt;do not execute&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>do not execute<\/script>/);
    assert.match(html, /回答时保存的引用快照分开显示/);
  } finally {
    await vite.close();
  }
});

test("embedded source preview sandbox never enables scripts with same-origin access", async () => {
  const vite = await createServer({
    configFile: "vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { EmbeddedSourcePreview } = await vite.ssrLoadModule(
      "/src/pages/Meetings/SourceViewer.jsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(EmbeddedSourcePreview, {
        src: "blob:http://localhost/safe-preview",
        title: "PDF preview",
      })
    );
    assert.match(html, /sandbox="allow-same-origin"/);
    assert.doesNotMatch(html, /allow-scripts/);
  } finally {
    await vite.close();
  }
});

test("background list polling reuses the currently applied date filter", () => {
  const active = {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-05T00:00:00.000Z",
  };
  assert.deepEqual(getPollingListParams(active), active);
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
