import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Meetings } from "@/models/meetings";
import {
  getMeetingActionCapabilities,
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

function isMinutesArtifact(source) {
  if (!source || source.deletedAt) return false;
  if (source.sourceType === "SUMMARY") return true;
  if (source.sourceType === "GATEWAY_ARTIFACT") {
    const key = `${source.originKey || ""} ${source.name || ""}`.toLowerCase();
    return /ai_.*minutes|meeting_summary|minutes/.test(key);
  }
  return false;
}

function originalText(source) {
  return String(source?.contentText || "").trim();
}

export default function SummaryAndTodos() {
  const { id } = useParams();
  const [meeting, setMeeting] = useState(null);
  const [sources, setSources] = useState([]);
  const [draft, setDraft] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const dirty = draft !== savedDraft;
  const actions = getMeetingActionCapabilities(meeting);
  const canEdit = actions.editContent;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await Meetings.detail(id);
      setMeeting(result.meeting);
      setSources(result.sources || []);
      const local = (result.sources || []).find(
        (source) => !source.deletedAt && source.sourceType === "LOCAL_SUMMARY"
      );
      const text = originalText(local);
      setDraft(text);
      setSavedDraft(text);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const importedOriginals = useMemo(
    () =>
      sources.filter(
        (source) => !source.deletedAt && isMinutesArtifact(source)
      ),
    [sources]
  );

  const combinedOriginal = useMemo(() => {
    const gatewayFirst = [...importedOriginals].sort((a, b) => {
      const aGateway = String(a.originKey || "").startsWith("gateway:") ? 0 : 1;
      const bGateway = String(b.originKey || "").startsWith("gateway:") ? 0 : 1;
      return aGateway - bGateway || a.id - b.id;
    });
    return gatewayFirst.map(originalText).filter(Boolean).join("\n\n");
  }, [importedOriginals]);

  async function save() {
    if (!meeting || !canEdit) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await Meetings.saveLocalSummary(meeting.id, {
        content: draft,
        contentVersion: meeting.contentVersion ?? 0,
      });
      setMeeting(result.meeting);
      setSavedDraft(draft);
      if (result.localSummary && !result.localSummary.deletedAt) {
        setSources((current) => {
          const without = current.filter(
            (source) => source.sourceType !== "LOCAL_SUMMARY"
          );
          return [...without, result.localSummary];
        });
      } else {
        setSources((current) =>
          current.filter((source) => source.sourceType !== "LOCAL_SUMMARY")
        );
      }
      setNotice("本地摘要已保存，索引将在后台重建。");
    } catch (e) {
      if (e.status === 409 || e.code === "CONTENT_VERSION_CONFLICT") {
        setError(
          "内容版本冲突：其他人已更新本场会议摘要。请保留当前草稿，刷新后合并再保存。"
        );
      } else if (e.code === "MEETING_IMMUTABLE") {
        setError("会议已审核，摘要不可再修改。");
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(savedDraft);
    setPreview(false);
    setError("");
    setNotice("");
  }

  if (loading) {
    return (
      <Page title="摘要与待办" description="正在加载会议摘要…">
        <Notice>正在读取会议详情。</Notice>
      </Page>
    );
  }

  if (!meeting) {
    return (
      <Page title="摘要与待办" description="无法加载会议">
        {error && <Notice tone="error">{error}</Notice>}
        <Link className="text-sm underline" to={paths.meetings.home()}>
          返回会议中心
        </Link>
      </Page>
    );
  }

  return (
    <Page
      title="摘要与待办"
      description={`${meeting.title || "未命名会议"} · ${formatDate(meeting.startTime)}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Status value={meeting.reviewStatus} />
          <Status value={meeting.retrievalStatus} />
          <Link
            className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
            to={paths.meetings.detail(meeting.id)}
          >
            返回会议详情
          </Link>
        </div>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {dirty && canEdit && <Notice>有未保存的本地摘要修改。</Notice>}

      <Panel title="腾讯导入原文（只读）">
        {importedOriginals.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            暂无导入的摘要原文。可直接编写本地维护摘要。
          </p>
        ) : (
          <div className="space-y-3">
            {importedOriginals.map((source) => (
              <div
                key={source.id}
                className="rounded-lg bg-theme-bg-primary p-3 text-sm"
              >
                <div className="mb-2 flex flex-wrap gap-2 text-xs text-theme-text-secondary">
                  <span>{getSourceTypeLabel(source.sourceType)}</span>
                  <span>
                    {source.name || source.originKey || `#${source.id}`}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans">
                  {originalText(source) || "（空）"}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="本地维护摘要"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!combinedOriginal || !canEdit || busy}
              onClick={() => setDraft(combinedOriginal)}
            >
              复制原文到编辑器
            </Button>
            <Button
              disabled={busy}
              onClick={() => setPreview((value) => !value)}
            >
              {preview ? "编辑" : "预览"}
            </Button>
          </div>
        }
      >
        <Field
          label="本地摘要"
          hint={
            canEdit
              ? "保存后写入 LOCAL_SUMMARY；清空并保存将回退检索到腾讯原文。"
              : "会议已审核，本地摘要只读。"
          }
        >
          {preview ? (
            <pre className="min-h-48 whitespace-pre-wrap rounded-lg border border-theme-sidebar-border bg-theme-bg-primary p-3 text-sm font-sans">
              {draft || "（空白）"}
            </pre>
          ) : (
            <textarea
              className={`${inputClass} min-h-48`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canEdit || busy}
              placeholder="在此维护本地摘要；留空表示未维护，检索回退腾讯原文。"
            />
          )}
        </Field>
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !dirty} onClick={save}>
              保存
            </Button>
            <Button disabled={busy || !dirty} onClick={cancel}>
              取消
            </Button>
          </div>
        )}
      </Panel>
    </Page>
  );
}
