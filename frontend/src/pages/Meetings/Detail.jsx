import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Meetings } from "@/models/meetings";
import {
  canDeleteSupplement,
  getMeetingDraftValues,
  getMeetingActionCapabilities,
  getUploadBatchFeedback,
  getPollingRefreshError,
  getActiveFileUsage,
  getSourceTypeLabel,
} from "@/models/meetingRules";
import paths from "@/utils/paths";
import {
  Button,
  Field,
  inputClass,
  Notice,
  Page,
  Panel,
  Status,
  formatDate,
} from "./MeetingsUI";

const MAX_FILE = 100_000_000;
const MAX_MEETING = 500_000_000;
const MAX_SOURCES = 20;

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [sources, setSources] = useState([]);
  const [summary, setSummary] = useState("");
  const [transcript, setTranscript] = useState("");
  const contentDraft = useRef({ summary: "", transcript: "" });
  const [textName, setTextName] = useState("");
  const [textBody, setTextBody] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (
      showLoading = true,
      { clearError = true, syncContent = false, preserveError = false } = {}
    ) => {
      if (showLoading) setLoading(true);
      if (clearError) setError("");
      try {
        const result = await Meetings.detail(id);
        setMeeting(result.meeting);
        setSources(result.sources || []);
        contentDraft.current = getMeetingDraftValues(
          contentDraft.current,
          result.meeting,
          !syncContent
        );
        setSummary(contentDraft.current.summary);
        setTranscript(contentDraft.current.transcript);
        if (preserveError)
          setError((current) => getPollingRefreshError(current, "", true));
      } catch (e) {
        setError((current) =>
          getPollingRefreshError(current, e.message, preserveError)
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [id]
  );
  useEffect(() => {
    refresh(true, { syncContent: true });
  }, [refresh]);
  useEffect(() => {
    const active =
      meeting?.retrievalStatus === "INDEXING" ||
      sources.some((source) =>
        ["PENDING", "PROCESSING"].includes(source.parseStatus)
      );
    if (!active) return undefined;
    const timer = window.setInterval(
      () => refresh(false, { clearError: false, preserveError: true }),
      3000
    );
    return () => window.clearInterval(timer);
  }, [meeting?.retrievalStatus, sources, refresh]);

  const activeSources = sources.filter((source) => !source.deletedAt);
  const { bytes: activeFileBytes, fileCount: activeFileCount } =
    getActiveFileUsage(activeSources);
  const supplementalSources = activeSources.filter((source) =>
    source.sourceType.startsWith("SUPPLEMENT_")
  );
  const originalSources = activeSources.filter(
    (source) => source.sourceType === "TENCENT_ORIGINAL"
  );
  const actions = getMeetingActionCapabilities(meeting);
  const canEdit = actions.editContent;
  const queryReady = meeting?.retrievalStatus === "AVAILABLE";
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return [summary, transcript].flatMap((text, index) =>
      text.toLowerCase().includes(needle)
        ? [{ label: index === 0 ? "摘要" : "转写", text }]
        : []
    );
  }, [search, summary, transcript]);

  async function perform(action, message, { syncContent = false } = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh(true, { syncContent });
      if (message) setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files) {
    const selected = [...files];
    if (!selected.length) return;
    if (activeFileCount + selected.length > MAX_SOURCES) {
      setError("每场会议最多保留 20 个有效来源（原始资料和补充资料合计）。");
      return;
    }
    if (selected.some((file) => file.size > MAX_FILE)) {
      setError("单个文件不能超过 100 MB。");
      return;
    }
    if (
      activeFileBytes + selected.reduce((sum, file) => sum + file.size, 0) >
      MAX_MEETING
    ) {
      setError("本场会议原始附件与用户补充文件合计不能超过 500 MB。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    let uploaded = 0;
    try {
      for (const file of selected) {
        await Meetings.addFile(id, file);
        uploaded += 1;
      }
      setNotice(getUploadBatchFeedback(uploaded, selected.length).notice);
      await refresh(false, { clearError: false, preserveError: true });
    } catch (e) {
      const feedback = getUploadBatchFeedback(
        uploaded,
        selected.length,
        e.message
      );
      setError(feedback.error);
      setNotice(feedback.notice);
      await refresh(false, { clearError: false, preserveError: true });
    } finally {
      setBusy(false);
    }
  }

  async function addText() {
    if (!textName.trim() || !textBody.trim()) {
      setError("请填写文本名称和内容。");
      return;
    }
    await perform(async () => {
      await Meetings.addText(id, textName.trim(), textBody);
      setTextName("");
      setTextBody("");
    }, "补充文本已提交。");
  }

  if (loading)
    return (
      <Page title="会议详情">
        <p>正在加载会议…</p>
      </Page>
    );
  if (!meeting)
    return (
      <Page title="会议详情">
        {error && <Notice tone="error">{error}</Notice>}
      </Page>
    );
  return (
    <Page
      title={meeting.title || "未命名会议"}
      description={`${formatDate(meeting.startTime)} · ${meeting.quarter || "未归档季度"}`}
      actions={
        <Link
          className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
          to={paths.meetings.home()}
        >
          返回会议中心，选择范围后问答
        </Link>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Panel
        title="状态与审核"
        actions={
          <div className="flex gap-2">
            <Status value={meeting.reviewStatus} />
            <Status value={meeting.retrievalStatus} />
          </div>
        }
      >
        {meeting.retrievalStatus === "WAITING_CONTENT" && (
          <Notice tone="warning">
            会议只有元数据，尚无可查询内容。请添加补充文件或文本；索引变为
            AVAILABLE 后才能问答和审核。
          </Notice>
        )}
        {meeting.retrievalStatus === "INDEX_FAILED" && (
          <Notice tone="error">
            索引失败。可查看来源解析错误，或为本场会议手动重建索引。
          </Notice>
        )}
        {meeting.retrievalStatus === "INDEXING" && (
          <Notice>索引正在更新，问答和审核暂不可用。</Notice>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={!queryReady || !actions.approve || busy}
            onClick={() => perform(() => Meetings.approve(id), "会议已审核。")}
          >
            审核通过
          </Button>
          <Button
            disabled={busy || meeting.retrievalStatus === "DELETED"}
            onClick={() =>
              perform(
                () => Meetings.reindex(id),
                "已提交本场会议的手动重建任务。"
              )
            }
          >
            手动重建索引
          </Button>
          {actions.deleteMeeting && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (window.confirm("确定删除这条草稿会议？")) {
                  await perform(async () => {
                    await Meetings.removeMeeting(id);
                    navigate(paths.meetings.home());
                  });
                }
              }}
            >
              删除草稿会议
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="摘要与转写">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="摘要">
            <textarea
              className={`${inputClass} min-h-48`}
              value={summary}
              onChange={(e) => {
                contentDraft.current = {
                  ...contentDraft.current,
                  summary: e.target.value,
                };
                setSummary(e.target.value);
              }}
              disabled={!canEdit}
            />
          </Field>
          <Field label="转写">
            <textarea
              className={`${inputClass} min-h-48`}
              value={transcript}
              onChange={(e) => {
                contentDraft.current = {
                  ...contentDraft.current,
                  transcript: e.target.value,
                };
                setTranscript(e.target.value);
              }}
              disabled={!canEdit}
            />
          </Field>
        </div>
        {canEdit && (
          <div className="mt-3">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                perform(
                  () => Meetings.updateContent(id, { summary, transcript }),
                  "摘要和转写已保存。",
                  { syncContent: true }
                )
              }
            >
              保存修改
            </Button>
          </div>
        )}
        <div className="mt-5">
          <Field label="在摘要和转写中查找">
            <input
              className={inputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="输入要查找的词语"
            />
          </Field>
          {searched.map((item) => (
            <div
              key={item.label}
              className="mt-2 rounded-lg bg-theme-bg-primary p-3 text-sm"
            >
              <b>{item.label}</b>
              <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={`腾讯会议原始资料（${originalSources.length}）`}>
        <p className="mb-3 text-xs text-theme-text-secondary">
          原始资料只读，不能删除或替换。预览、定位和下载均会再次检查当前登录权限。
        </p>
        {originalSources.length ? (
          <ul className="space-y-2">
            {originalSources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                meetingId={id}
                busy={busy}
                onRetry={() =>
                  perform(
                    () => Meetings.retrySource(id, source.id),
                    "已提交解析重试。"
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-theme-text-secondary">
            当前没有腾讯原始附件。
          </p>
        )}
      </Panel>
      <Panel
        title={`补充文件（${supplementalSources.filter((source) => source.sourceType === "SUPPLEMENT_FILE").length}）`}
        actions={
          actions.addSupplementFile && (
            <label className="cursor-pointer rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm">
              添加文件
              <input
                className="sr-only"
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => {
                  uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )
        }
      >
        <p className="mb-3 text-xs text-theme-text-secondary">
          每个文件 ≤100 MB；腾讯原始附件与用户补充文件合计最多 20 个、500
          MB。补充文本不占附件数量和容量。已审核会议可以添加新文件，添加后会返回草稿；删除和重新上传仅限草稿。相同内容的文件会被拒绝。修改文件请删除后重新上传。
        </p>
        {supplementalSources.filter(
          (source) => source.sourceType === "SUPPLEMENT_FILE"
        ).length ? (
          <ul className="space-y-2">
            {supplementalSources
              .filter((source) => source.sourceType === "SUPPLEMENT_FILE")
              .map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  meetingId={id}
                  busy={busy}
                  canDelete={canDeleteSupplement(meeting, source)}
                  onDelete={() =>
                    perform(
                      () => Meetings.deleteSource(id, source.id),
                      "补充文件已删除。可重新上传更新后的文件。"
                    )
                  }
                  onRetry={() =>
                    perform(
                      () => Meetings.retrySource(id, source.id),
                      "已提交解析重试。"
                    )
                  }
                />
              ))}
          </ul>
        ) : (
          <p className="text-sm text-theme-text-secondary">尚无补充文件。</p>
        )}
      </Panel>
      <Panel
        title={`补充文本（${supplementalSources.filter((source) => source.sourceType === "SUPPLEMENT_TEXT").length}）`}
      >
        <p className="mb-3 text-xs text-theme-text-secondary">
          补充文本提交后不可直接编辑；请删除现有文本来源，再添加修改后的文本。已审核会议删除文本后会返回草稿。补充文本不占附件数量和容量。
        </p>
        {supplementalSources
          .filter((source) => source.sourceType === "SUPPLEMENT_TEXT")
          .map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              meetingId={id}
              busy={busy}
              canDelete={canDeleteSupplement(meeting, source)}
              onDelete={() =>
                perform(
                  () => Meetings.deleteSource(id, source.id),
                  "补充文本已删除。"
                )
              }
            />
          ))}
        {actions.addSupplementText && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="文本名称">
              <input
                className={inputClass}
                value={textName}
                onChange={(e) => setTextName(e.target.value)}
              />
            </Field>
            <span />
            <Field label="添加文本">
              <textarea
                className={`${inputClass} min-h-32`}
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={busy} onClick={addText}>
                添加补充文本
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function SourceRow({
  source,
  meetingId,
  busy,
  canDelete = false,
  onDelete,
  onRetry,
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-theme-bg-primary p-3 text-sm">
      <div className="min-w-0">
        <Link
          className="font-medium underline"
          to={paths.meetings.source(meetingId, source.id)}
        >
          {source.name || `${source.sourceType} #${source.id}`}
        </Link>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-theme-text-secondary">
          <span>{getSourceTypeLabel(source.sourceType)}</span>
          <span>{Number(source.bytes || 0).toLocaleString()} bytes</span>
          <Status value={source.parseStatus} />
          {source.error && <span className="text-red-300">{source.error}</span>}
        </div>
      </div>
      <div className="flex gap-2">
        {source.parseStatus === "FAILED" && onRetry && (
          <Button disabled={busy} onClick={onRetry}>
            重试解析
          </Button>
        )}
        {canDelete && onDelete && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("删除此补充来源？历史回答仍保留原证据快照。"))
                onDelete();
            }}
          >
            删除
          </Button>
        )}
      </div>
    </li>
  );
}
