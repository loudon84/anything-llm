import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { saveAs } from "file-saver";
import { fetchMeetingBlob, Meetings } from "@/models/meetings";
import { compareCitedSource } from "@/models/meetingRules";
import paths from "@/utils/paths";
import { Button, Notice, Page, Panel, Status, formatDate } from "./MeetingsUI";

export default function MeetingSourceViewer() {
  const { id, sourceId } = useParams();
  const routerLocation = useLocation();
  const workspace = routerLocation.state?.workspace;
  const snapshot = routerLocation.state?.snapshot;
  const [source, setSource] = useState(null);
  const [segments, setSegments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    let live = true;
    if (workspace) {
      setLoading(false);
      return () => {
        live = false;
      };
    }
    setLoading(true);
    setError("");
    Meetings.segments(id, sourceId)
      .then((result) => {
        if (!live) return;
        setSource(result.source);
        const value = Array.isArray(result.segments)
          ? result.segments
          : result.segments?.segments || [];
        setSegments(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, sourceId, workspace]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  async function openFile(download) {
    setBusy(true);
    setError("");
    try {
      const url = workspace
        ? Meetings.workspaceFileUrl(
            workspace.id,
            workspace.documentId,
            download
          )
        : Meetings.fileUrl(id, sourceId, download);
      const blob = await fetchMeetingBlob(url);
      if (download)
        saveAs(blob, source?.name || snapshot?.sourceName || "meeting-source");
      else {
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const title = snapshot?.sourceName || source?.name || "证据来源";
  const sourceState = source
    ? compareCitedSource(snapshot?.citedSource, source)
    : error
      ? "unavailable"
      : "loading";
  const latestContent = source?.contentText || source?.text || "";
  const targetIndex = snapshot?.location
    ? segments.findIndex((segment) =>
        sameLocation(segment.location, snapshot.location)
      )
    : -1;

  return (
    <Page
      title={title}
      description={
        workspace
          ? "工作区引用快照与当前授权文件"
          : `${source?.sourceType || "会议来源"} · ${source?.parseStatus || ""}`
      }
      actions={
        <Link
          className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
          to={workspace ? paths.meetings.home() : paths.meetings.detail(id)}
        >
          返回{workspace ? "会议问答" : "会议详情"}
        </Link>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {snapshot && (
        <Panel title="回答时保存的引用快照">
          <p className="text-xs text-theme-text-secondary">
            {snapshot.meetingTitle || source?.meetingTitle || "来源快照"} ·{" "}
            {formatDate(snapshot.meetingStartTime)} ·{" "}
            {snapshot.sourceRevision
              ? `版本 ${snapshot.sourceRevision}`
              : "已保存"}
          </p>
          <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-blue-400 pl-4">
            {snapshot.quote}
          </blockquote>
          <p className="mt-2 text-xs text-theme-text-secondary">
            该摘录属于回答时保存的快照。即使当前文件已修改或删除，历史引用仍保持原样。
          </p>
          {snapshot.freshness?.stale && (
            <Notice tone="warning">
              回答历史标记为资料已变化；请分别核对当时快照和当前来源。
            </Notice>
          )}
        </Panel>
      )}
      {workspace ? (
        <Panel title="工作区来源">
          <Notice>
            工作区文档目前只提供文件级溯源；页面显示所选摘录，无法定位到精确段落或页码。打开当前文件时会再次检查工作区权限和文档成员关系。
          </Notice>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => openFile(false)}>
              预览当前文件
            </Button>
            <Button disabled={busy} onClick={() => openFile(true)}>
              下载当前文件
            </Button>
          </div>
          {previewUrl && (
            <div className="mt-4">
              <iframe
                title="当前工作区文件预览"
                src={previewUrl}
                className="h-[65vh] w-full rounded-lg border border-theme-sidebar-border"
              />
            </div>
          )}
        </Panel>
      ) : (
        <>
          {loading ? (
            <p>正在读取来源和定位信息…</p>
          ) : (
            source && (
              <>
                {(sourceState === "deleted" ||
                  source.deletedAt ||
                  source.deleted) && (
                  <Notice tone="warning">
                    此来源已从当前会议删除。下面的回答引用仍是原始快照；若存储保留期限已过，当前文件可能无法读取。
                  </Notice>
                )}
                {sourceState === "modified" && (
                  <Notice tone="warning">
                    当前来源版本已变化。上方引用是回答时快照，下面展示的是当前来源。
                  </Notice>
                )}
                {sourceState === "unchanged" && (
                  <Notice>当前来源与回答时保存的来源版本一致。</Notice>
                )}
                {sourceState === "unavailable" && (
                  <Notice tone="warning">
                    当前来源可读取，但回答时没有保存可核对的版本指纹；上方引用仍是回答时保存的摘录。
                  </Notice>
                )}
                <Panel
                  title="来源状态"
                  actions={
                    <div className="flex gap-2">
                      <Status value={source.parseStatus} />
                      <Status value={source.sourceType} />
                    </div>
                  }
                >
                  <p className="text-sm">
                    {source.name} · {Number(source.bytes || 0).toLocaleString()}{" "}
                    bytes
                  </p>
                  {source.error && (
                    <p className="mt-2 text-sm text-red-300">
                      解析错误：{source.error}
                    </p>
                  )}
                  {source.sourceType !== "SUPPLEMENT_TEXT" && (
                    <div className="mt-3 flex gap-2">
                      <Button disabled={busy} onClick={() => openFile(false)}>
                        预览当前来源
                      </Button>
                      <Button disabled={busy} onClick={() => openFile(true)}>
                        下载当前来源
                      </Button>
                    </div>
                  )}
                  {previewUrl && (
                    <div className="mt-4">
                      <iframe
                        title="当前来源文件预览"
                        src={previewUrl}
                        className="h-[65vh] w-full rounded-lg border border-theme-sidebar-border"
                      />
                    </div>
                  )}
                </Panel>
                <Panel title={`解析片段与位置（${segments.length}）`}>
                  {targetIndex >= 0 && (
                    <Notice>
                      已定位到回答引用对应的第 {targetIndex + 1} 个来源片段。
                    </Notice>
                  )}
                  {segments.length === 0 && !latestContent && (
                    <p className="text-sm text-theme-text-secondary">
                      来源没有可展示的文本片段或位置记录。
                    </p>
                  )}
                  {latestContent && (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-theme-bg-primary p-3 text-sm">
                      {latestContent}
                    </pre>
                  )}
                  {segments.length > 0 && (
                    <ol className="space-y-3">
                      {segments.map((segment, index) => (
                        <li
                          key={`${index}-${segment.location?.paragraph || segment.location?.page || "segment"}`}
                          className={`rounded-lg p-3 ${index === targetIndex ? "border-2 border-blue-400 bg-blue-950/30" : "bg-theme-bg-primary"}`}
                        >
                          <div className="mb-2 text-xs text-theme-text-secondary">
                            片段 {index + 1} · {locationLabel(segment.location)}
                          </div>
                          <p className="whitespace-pre-wrap text-sm">
                            {segment.text}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </Panel>
              </>
            )
          )}
        </>
      )}
    </Page>
  );
}

function locationLabel(location = {}) {
  const labels = [];
  if (location.type) labels.push(location.type);
  if (location.paragraph != null) labels.push(`第 ${location.paragraph} 段`);
  if (location.page != null) labels.push(`第 ${location.page} 页`);
  if (location.sheet) labels.push(`工作表 ${location.sheet}`);
  if (location.cell) labels.push(`单元格 ${location.cell}`);
  if (location.slide != null) labels.push(`第 ${location.slide} 张幻灯片`);
  if (location.startMs != null)
    labels.push(
      `${(location.startMs / 1000).toFixed(1)}–${(location.endMs / 1000).toFixed(1)} 秒`
    );
  return labels.length ? labels.join(" · ") : "未提供精确位置";
}

function sameLocation(left = {}, right = {}) {
  const fields = [
    "paragraph",
    "page",
    "sheet",
    "cell",
    "slide",
    "startMs",
    "endMs",
  ];
  return (
    fields.some((field) => left[field] != null && right[field] != null) &&
    fields.every(
      (field) =>
        left[field] == null ||
        right[field] == null ||
        left[field] === right[field]
    ) &&
    (left.type == null || right.type == null || left.type === right.type)
  );
}
