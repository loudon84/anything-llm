import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Meetings, getMeetingSelectionState } from "@/models/meetings";
import {
  getDateBounds,
  getPollingListParams,
  getRemoteMeetingPage,
  validateMeetingImport,
} from "@/models/meetingRules";
import paths from "@/utils/paths";
import {
  Button,
  CoverageBadge,
  Field,
  inputClass,
  Notice,
  Page,
  Panel,
  Status,
  formatDate,
} from "./MeetingsUI";

function currentQuarter() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function shanghaiDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const stageLabels = {
  FETCHING: "正在获取会议内容和附件",
  PARSING_OCR: "正在解析附件或执行 OCR",
  INDEXING: "正在生成检索索引",
  PUBLISHING: "正在发布会议记录",
  METADATA_ONLY: "已保存元数据草稿",
  COMMITTED: "会议记录已发布",
};

export default function MeetingsCenter() {
  const navigate = useNavigate();
  const [quarter, setQuarter] = useState(currentQuarter());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [meetings, setMeetings] = useState([]);
  const [conversationHistory, setConversationHistory] = useState([]);
  const activeListQuery = useRef({ quarter });
  const [selected, setSelected] = useState(new Set());
  const [jobs, setJobs] = useState([]);
  const [remote, setRemote] = useState([]);
  const [nextCursor, setNextCursor] = useState("");
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteFrom, setRemoteFrom] = useState(shanghaiDate(-30));
  const [remoteTo, setRemoteTo] = useState(shanghaiDate());
  const [connectionId, setConnectionId] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [manifestTarget, setManifestTarget] = useState(null);
  const [attachmentIds, setAttachmentIds] = useState(new Set());
  const [scopeFrom, setScopeFrom] = useState("");
  const [scopeTo, setScopeTo] = useState("");
  const [discoveryWindow, setDiscoveryWindow] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [showScopeDialog, setShowScopeDialog] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState(new Set());
  const [importing, setImporting] = useState(false);

  const refreshMeetings = useCallback(
    async (params = {}, preserveSelection = false) => {
      setLoading(true);
      setError("");
      try {
        const rows = await Meetings.list(params);
        setMeetings(rows);
        setSelected((current) =>
          preserveSelection
            ? new Set(
                [...current].filter((id) =>
                  rows.some((meeting) => meeting.id === id)
                )
              )
            : new Set(rows.map(({ id }) => id))
        );
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await Meetings.jobs());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    const query = { quarter };
    activeListQuery.current = query;
    refreshMeetings(query);
    refreshJobs();
    Meetings.conversations()
      .then(setConversationHistory)
      .catch((e) => setError(e.message));
    Meetings.config()
      .then((config) => setConnectionId(config?.id || null))
      .catch((e) => setError(e.message));
  }, [quarter, refreshMeetings, refreshJobs]);

  useEffect(() => {
    const active = jobs.some(({ status }) =>
      ["CREATED", "PROCESSING"].includes(status)
    );
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      refreshJobs();
      refreshMeetings(getPollingListParams(activeListQuery.current), true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [jobs, quarter, refreshJobs, refreshMeetings]);

  const state = useMemo(
    () => getMeetingSelectionState(meetings, selected),
    [meetings, selected]
  );

  async function applyDateRange() {
    try {
      const bounds = getDateBounds(from, to);
      setError("");
      activeListQuery.current = bounds;
      await refreshMeetings(bounds);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadRemote(next = "") {
    setError("");
    setLoading(true);
    try {
      const bounds = getDateBounds(remoteFrom, remoteTo);
      if (new Date(bounds.to) - new Date(bounds.from) > 90 * 86_400_000)
        throw new Error("腾讯会议历史查询区间最多 90 天。");
      const query = {
        startTime: bounds.from,
        endTime: bounds.to,
        connectionId: connectionId || undefined,
        ...(next ? { cursor: next } : {}),
      };
      const result = await Meetings.remote(query);
      const { items: rows, nextCursor: cursor } = getRemoteMeetingPage(result);
      setDiscoveryWindow({ startTime: bounds.from, endTime: bounds.to });
      const mappedRows = rows.map((row) => ({
        ...row,
        connectionId: row.connectionId || connectionId,
      }));
      setRemote((current) => (next ? [...current, ...mappedRows] : mappedRows));
      setNextCursor(cursor);
      setRemoteOpen(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function chooseRemote(row) {
    setManifestTarget(row);
    setManifest(null);
    setImporting(true);
    setError("");
    try {
      const bounds = getDateBounds(remoteFrom, remoteTo);
      const window = discoveryWindow || {
        startTime: bounds.from,
        endTime: bounds.to,
      };
      const response = await Meetings.manifest(row.externalId, {
        connectionId: row.connectionId,
        startTime: row.startTime || window.startTime,
        endTime: row.endTime || window.endTime,
      });
      setManifest(response);
      setAttachmentIds(
        new Set(
          (response.attachments || []).map(
            ({ externalFileId }) => externalFileId
          )
        )
      );
      setScopeFrom("");
      setScopeTo("");
    } catch (e) {
      setError(e.message);
      setManifestTarget(null);
    } finally {
      setImporting(false);
    }
  }

  async function startImport() {
    if (!manifestTarget || actionBusy) return;
    const selectedAttachments = (manifest?.attachments || []).filter(
      ({ externalFileId }) => attachmentIds.has(externalFileId)
    );
    const validation = validateMeetingImport({
      manifest,
      attachments: selectedAttachments,
      from: scopeFrom,
      to: scopeTo,
      discoveryStart: discoveryWindow?.startTime,
      discoveryEnd: discoveryWindow?.endTime,
    });
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      await Meetings.importMeeting({
        connectionId: manifestTarget.connectionId,
        externalId: manifestTarget.externalId,
        scope: validation.scope,
      });
      setManifestTarget(null);
      setManifest(null);
      await refreshJobs();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function prepareConversation() {
    if (!state.canStart || actionBusy) return;
    setActionBusy(true);
    setError("");
    try {
      setWorkspaces(await Meetings.workspaces());
      setSelectedWorkspaces(new Set());
      setShowScopeDialog(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function startConversation() {
    if (!state.canStart || actionBusy) return;
    setActionBusy(true);
    setError("");
    try {
      const conversation = await Meetings.createConversation(
        [...selected],
        [...selectedWorkspaces]
      );
      navigate(paths.meetings.conversation(conversation.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <Page
      title="会议情报中心"
      description="按季度查看已导入会议，选择固定会议范围进行问答。日期区间按中国标准时间计算，结束日包含在内。"
      actions={
        <>
          <Link
            className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
            to={paths.meetings.settings()}
          >
            连接设置
          </Link>
          <Button onClick={() => loadRemote()} disabled={loading}>
            从腾讯会议导入
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Panel title="最近的问答会话">
        {conversationHistory.length ? (
          <ul className="space-y-2">
            {conversationHistory.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  className="block rounded-lg bg-theme-bg-primary p-3 text-sm underline"
                  to={paths.meetings.conversation(conversation.id)}
                >
                  会话 #{conversation.id} · {conversation.meetingIds.length}{" "}
                  场会议 · {conversation.workspaceIds.length} 个工作区 ·{" "}
                  {formatDate(conversation.createdAt)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-theme-text-secondary">
            暂无可访问的历史会话。
          </p>
        )}
      </Panel>
      <Panel
        title="会议范围"
        actions={
          <Button
            onClick={() => refreshMeetings(activeListQuery.current)}
            disabled={loading}
          >
            {loading ? "加载中…" : "刷新"}
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="季度">
            <input
              aria-label="选择季度"
              type="text"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              className={inputClass}
              placeholder="2026-Q4"
            />
          </Field>
          <Field label="开始日期">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="结束日期（包含）">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={applyDateRange}>按日期筛选并全选</Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-theme-text-secondary">
          筛选后自动选中所有结果；可逐项调整。选中数上限为 10，不会自动删减。
        </p>
      </Panel>
      {meetings.length === 0 && !loading ? (
        <Notice>此筛选范围内没有会议。</Notice>
      ) : (
        <Panel title={`会议列表（已选 ${state.count} 项）`}>
          {state.overLimit && (
            <Notice tone="warning">
              当前选中 {state.count} 项，超过 10 项上限。请取消部分选择后继续。
            </Notice>
          )}
          {state.unavailableIds.length > 0 && (
            <Notice tone="warning">
              有 {state.unavailableIds.length}{" "}
              项尚未建立可用索引。请取消这些项目或先补充会议资料。
            </Notice>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-theme-sidebar-border text-theme-text-secondary">
                  <th className="p-2">选择</th>
                  <th className="p-2">会议</th>
                  <th className="p-2">时间</th>
                  <th className="p-2">审核</th>
                  <th className="p-2">内容状态</th>
                  <th className="p-2">覆盖情况</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((meeting) => (
                  <tr
                    key={meeting.id}
                    className="border-b border-theme-sidebar-border/60"
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`选择会议 ${meeting.title}`}
                        checked={selected.has(meeting.id)}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            e.target.checked
                              ? next.add(meeting.id)
                              : next.delete(meeting.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <Link
                        className="underline"
                        to={paths.meetings.detail(meeting.id)}
                      >
                        {meeting.title || "未命名会议"}
                      </Link>
                    </td>
                    <td className="p-2">{formatDate(meeting.startTime)}</td>
                    <td className="p-2">
                      <Status value={meeting.reviewStatus} />
                    </td>
                    <td className="p-2">
                      <Status value={meeting.retrievalStatus} />
                    </td>
                    <td className="p-2">
                      <CoverageBadge coverage={meeting.coverage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-theme-text-secondary">
              只有资料就绪的会议可以进入问答。元数据草稿可取消选择。
            </span>
            <Button
              variant="primary"
              disabled={!state.canStart || actionBusy}
              onClick={prepareConversation}
            >
              {actionBusy ? "正在加载…" : "使用所选会议开始问答"}
            </Button>
          </div>
        </Panel>
      )}
      <Panel
        title="导入任务"
        actions={<Button onClick={refreshJobs}>更新任务</Button>}
      >
        {jobs.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">暂无任务。</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <ImportJobRow
                key={job.id}
                job={job}
                onRetry={async () => {
                  try {
                    await Meetings.retryJob(job.id);
                    await refreshJobs();
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </Panel>
      {remoteOpen && (
        <Panel
          title="腾讯会议记录"
          actions={
            <>
              <Button
                onClick={() => loadRemote(nextCursor)}
                disabled={!nextCursor || loading}
              >
                下一页
              </Button>
              <Button onClick={() => setRemoteOpen(false)}>关闭</Button>
            </>
          }
        >
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Field label="查询开始日期">
              <input
                type="date"
                value={remoteFrom}
                onChange={(e) => setRemoteFrom(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="查询结束日期（包含）">
              <input
                type="date"
                value={remoteTo}
                onChange={(e) => setRemoteTo(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => loadRemote()} disabled={loading}>
                查询 90 天内会议
              </Button>
            </div>
          </div>
          {remote.length ? (
            <div className="space-y-2">
              {remote.map((row) => (
                <div
                  key={row.externalId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-theme-bg-primary p-3"
                >
                  <div>
                    <div className="font-medium">
                      {row.title || row.subject || row.externalId}
                    </div>
                    <div className="text-xs text-theme-text-secondary">
                      {formatDate(row.startTime)} · {row.externalId}
                    </div>
                  </div>
                  <Button onClick={() => chooseRemote(row)}>
                    选择导入范围
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-theme-text-secondary">
              此日期范围内没有会议记录。
            </p>
          )}
        </Panel>
      )}
      {manifestTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-theme-bg-primary p-5">
            <h2 id="import-title" className="text-lg font-semibold">
              选择导入内容
            </h2>
            <p className="mt-1 text-sm text-theme-text-secondary">
              {manifestTarget.title || manifestTarget.externalId} ·
              一次只导入一场会议
            </p>
            {importing ? (
              <p className="py-6">正在读取附件清单…</p>
            ) : (
              <div className="mt-4 space-y-4">
                {error && <Notice tone="error">{error}</Notice>}
                {manifest && (
                  <Notice>
                    摘要：如存在则保留整场摘要；转写：
                    {scopeFrom || scopeTo
                      ? `所选 ${scopeFrom || 0}–${scopeTo || "未填写"} 毫秒`
                      : "完整转写"}
                    ；已选附件：
                    {(manifest.attachments || [])
                      .filter((item) => attachmentIds.has(item.externalFileId))
                      .map((item) => item.name)
                      .join("、") || "无"}
                    ；排除附件：
                    {(manifest.attachments || [])
                      .filter((item) => !attachmentIds.has(item.externalFileId))
                      .map((item) => item.name)
                      .join("、") || "无"}
                  </Notice>
                )}
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">
                    附件（可多选）
                  </legend>
                  {(manifest?.attachments || []).length ? (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {manifest.attachments.map((item) => (
                        <label
                          key={item.externalFileId}
                          className="flex gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={attachmentIds.has(item.externalFileId)}
                            onChange={(e) =>
                              setAttachmentIds((current) => {
                                const next = new Set(current);
                                e.target.checked
                                  ? next.add(item.externalFileId)
                                  : next.delete(item.externalFileId);
                                return next;
                              })
                            }
                          />
                          <span>
                            {item.name} ·{" "}
                            {item.bytes == null
                              ? "大小待下载时确认（服务端执行单文件上限）"
                              : `${Number(item.bytes).toLocaleString()} bytes`}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-theme-text-secondary">
                      没有可选文档附件；仍可导入会议纪要内容。
                    </p>
                  )}
                </fieldset>
                {manifest?.capabilities?.transcript === "supported" ||
                manifest?.capabilities?.transcript?.status === "supported" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field
                      label="开始偏移（毫秒）"
                      hint="两项均留空表示完整转写；只填结束偏移表示从 0 开始；填写开始偏移时也要填写结束偏移。"
                    >
                      <input
                        type="number"
                        min="0"
                        value={scopeFrom}
                        onChange={(e) => setScopeFrom(e.target.value)}
                        className={inputClass}
                      />
                    </Field>
                    <Field
                      label="结束偏移（毫秒）"
                      hint="结束偏移必须晚于开始偏移；选择范围单次最多 3 小时。"
                    >
                      <input
                        type="number"
                        min="0"
                        value={scopeTo}
                        onChange={(e) => setScopeTo(e.target.value)}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                ) : (
                  <Notice>
                    清单确认没有可选转写；可以直接导入元数据或所选附件，不需要填写虚构的转写偏移。
                  </Notice>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => {
                      setManifestTarget(null);
                      setManifest(null);
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    disabled={actionBusy}
                    onClick={startImport}
                  >
                    {actionBusy ? "正在提交…" : "导入这一场会议"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {showScopeDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="scope-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-theme-bg-primary p-5">
            <h2 id="scope-title" className="text-lg font-semibold">
              固定问答范围
            </h2>
            <p className="mt-2 text-sm text-theme-text-secondary">
              已选择 {state.count}{" "}
              场会议。工作区默认不选；只会检索你在此明确勾选的可访问工作区。
            </p>
            <fieldset className="my-4 space-y-2">
              <legend className="mb-2 font-medium">可用工作区</legend>
              {workspaces.length ? (
                workspaces.map((workspace) => (
                  <label
                    key={workspace.id}
                    className="flex items-center gap-2 rounded-lg bg-theme-bg-secondary p-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedWorkspaces.has(workspace.id)}
                      onChange={(e) =>
                        setSelectedWorkspaces((current) => {
                          const next = new Set(current);
                          e.target.checked
                            ? next.add(workspace.id)
                            : next.delete(workspace.id);
                          return next;
                        })
                      }
                    />
                    <span>{workspace.name || workspace.slug}</span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-theme-text-secondary">
                  当前没有可访问工作区。会议资料仍可用于问答。
                </p>
              )}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowScopeDialog(false)}>取消</Button>
              <Button
                variant="primary"
                disabled={actionBusy}
                onClick={startConversation}
              >
                {actionBusy ? "正在创建…" : "创建固定范围"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

export function ImportJobRow({ job, onRetry }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-theme-bg-primary p-3 text-sm">
      <div className="min-w-0">
        <div>
          {job.kind} · {stageLabels[job.stage] || job.stage || "处理中"}
        </div>
        {job.error && (
          <div className="mt-1 break-words text-xs text-red-300">
            错误：{job.error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Status value={job.status} />
        {job.status === "FAILED" && onRetry && (
          <Button onClick={onRetry}>重试</Button>
        )}
      </div>
    </li>
  );
}
