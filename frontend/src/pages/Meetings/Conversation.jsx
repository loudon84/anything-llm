import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Meetings } from "@/models/meetings";
import {
  getCitationLocationLabel,
  getAnswerStatusLabel,
  getWorkspaceCitationSnapshot,
  getReanswerDraft,
} from "@/models/meetingRules";
import paths from "@/utils/paths";
import {
  Button,
  CoverageBadge,
  Notice,
  Page,
  Panel,
  Status,
  formatDate,
} from "./MeetingsUI";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function MeetingConversation() {
  const { id } = useParams();
  const [conversation, setConversation] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [meetingReadFailure, setMeetingReadFailure] = useState(false);
  const [question, setQuestion] = useState("");
  const [clarification, setClarification] = useState("");
  const [reanswerId, setReanswerId] = useState("");
  const [targetMeeting, setTargetMeeting] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    setMeetingReadFailure(false);
    try {
      const [scope, history] = await Promise.all([
        Meetings.conversation(id),
        Meetings.answers(id),
      ]);
      setConversation(scope);
      setAnswers(history);
      const scopeIds = asArray(scope.meetingIds);
      const results = await Promise.allSettled(
        scopeIds.map((meetingId) => Meetings.detail(meetingId))
      );
      const rows = results.filter((result) => result.status === "fulfilled");
      setMeetings(rows.map(({ value }) => value.meeting));
      setMeetingReadFailure(rows.length !== results.length);
      if (rows.length !== results.length)
        setError(
          "无法读取固定范围中所有会议的当前状态；为避免使用过期范围，问答已暂停。"
        );
      if (!targetMeeting && scopeIds.length)
        setTargetMeeting(String(scopeIds[0]));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [id]);

  const scopeIds = asArray(conversation?.meetingIds);
  const workspaceIds = asArray(conversation?.workspaceIds);
  const scopeState = conversation?.scopeState || {};
  const blocked =
    meetingReadFailure ||
    scopeState.available !== true ||
    meetings.some(({ retrievalStatus }) => retrievalStatus !== "AVAILABLE");
  const blockedMeetings = meetings.filter(
    ({ retrievalStatus }) => retrievalStatus !== "AVAILABLE"
  );
  const currentAnswers = useMemo(() => answers.slice().reverse(), [answers]);
  const latestAnswer = answers[answers.length - 1];
  const chosenAnswer = answers.find(
    (answer) => String(answer.id) === String(reanswerId)
  );
  const supplementRequired =
    chosenAnswer &&
    ["AWAITING_SOURCES", "FAILED_INCOMPLETE"].includes(chosenAnswer.status);
  const askingDisabled = blocked || asking || !question.trim();

  async function submit(event) {
    event.preventDefault();
    if (askingDisabled) return;
    setAsking(true);
    setError("");
    try {
      const answer = await Meetings.ask(id, {
        question: question.trim(),
        ...(reanswerId ? { previousAnswerId: Number(reanswerId) } : {}),
        ...(clarification.trim()
          ? { clarification: clarification.trim() }
          : {}),
      });
      setQuestion("");
      setClarification("");
      setReanswerId("");
      setAnswers((previous) => [...previous, answer]);
    } catch (e) {
      setError(e.message);
    } finally {
      setAsking(false);
    }
  }

  if (loading)
    return (
      <Page title="会议问答">
        <p>正在读取固定范围和历史…</p>
      </Page>
    );
  return (
    <Page
      title="会议问答"
      description="本会话的会议和工作区范围固定。历史回答仅保存证据快照，不会被当作新证据。"
      actions={
        <Link
          className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
          to={paths.meetings.home()}
        >
          会议中心
        </Link>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Panel title="固定范围">
        <p className="text-sm">
          会议 {scopeIds.length} 场 · 工作区 {workspaceIds.length} 个
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {meetings.map((meeting) => (
            <Link
              key={meeting.id}
              to={paths.meetings.detail(meeting.id)}
              className="rounded-lg bg-theme-bg-primary px-3 py-2 text-sm underline"
            >
              {meeting.title} · <Status value={meeting.retrievalStatus} />
            </Link>
          ))}
        </div>
        {blocked && (
          <Notice tone="error">
            {meetingReadFailure
              ? "固定范围的会议状态读取不完整。请刷新后再试。"
              : scopeState.blockedReason ||
                `固定范围中的 ${blockedMeetings.length} 场会议当前不可用。`}
            新问题和重新回答已暂停。请到会议详情补充资料或等待索引完成。
          </Notice>
        )}
        {scopeState.available === true && !blocked && (
          <Notice>
            当前固定范围可用。检索只使用这些会议以及明确选择的工作区。
          </Notice>
        )}
      </Panel>
      <Panel title="提问或重新回答">
        {chosenAnswer && (
          <Notice tone="warning">
            正在基于第 {chosenAnswer.id}{" "}
            条历史问题重新回答。旧答案和证据快照会保留在历史中。
          </Notice>
        )}
        {chosenAnswer && (
          <div className="my-3">
            <label className="text-sm font-medium">补充说明（可选）</label>
            <textarea
              className="mt-1 w-full rounded-lg border border-theme-sidebar-border bg-theme-bg-primary p-3 text-sm"
              rows="3"
              value={clarification}
              onChange={(e) => setClarification(e.target.value)}
              placeholder="补充你希望回答者重点澄清的内容"
              disabled={blocked}
            />
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium">
            问题
            <textarea
              className="mt-1 w-full rounded-lg border border-theme-sidebar-border bg-theme-bg-primary p-3 text-sm"
              rows="3"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例如：会议决定的负责人和截止时间是什么？"
              disabled={blocked}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(reanswerId)}
                onChange={(e) => {
                  if (e.target.checked && latestAnswer) {
                    const draft = getReanswerDraft(latestAnswer);
                    setReanswerId(draft.reanswerId);
                    setQuestion(draft.question);
                    setClarification(draft.clarification);
                  } else {
                    setReanswerId("");
                    setQuestion("");
                    setClarification("");
                  }
                }}
                disabled={blocked || !answers.length}
              />
              <span>基于最新回答重新回答</span>
            </label>
            <Button variant="primary" type="submit" disabled={askingDisabled}>
              {asking
                ? "正在检索并回答…"
                : reanswerId
                  ? "保留历史并重新回答"
                  : "提问"}
            </Button>
          </div>
        </form>
      </Panel>
      {supplementRequired && (
        <Panel title="补充当前会议证据">
          <Notice tone="warning">
            这是证据不足或回答中断状态。请先确认要补充哪一场会议；这不会更改其他会议，也不会把缺失证据和服务故障混为一谈。
          </Notice>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="text-sm">
              选择目标会议
              <select
                value={targetMeeting}
                onChange={(e) => setTargetMeeting(e.target.value)}
                className="ml-2 rounded-lg border border-theme-sidebar-border bg-theme-bg-primary p-2"
              >
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meeting.title}
                  </option>
                ))}
              </select>
            </label>
            <Link
              className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
              to={paths.meetings.detail(targetMeeting)}
            >
              打开目标会议并补充资料
            </Link>
          </div>
        </Panel>
      )}
      <Panel title="问答历史">
        {currentAnswers.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">尚无问答记录。</p>
        ) : (
          <div className="space-y-4">
            {currentAnswers.map((answer) => (
              <AnswerCard
                key={answer.id}
                answer={answer}
                blocked={blocked}
                meetings={meetings}
                onReanswer={() => {
                  const draft = getReanswerDraft(answer);
                  setReanswerId(draft.reanswerId);
                  setQuestion(draft.question);
                  setClarification(draft.clarification);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}

function AnswerCard({ answer, blocked, meetings, onReanswer }) {
  const citations = asArray(answer.citations);
  const snapshots =
    answer.sourceState?.citedSources || answer.sourceState?.manifest || [];
  return (
    <article className="rounded-lg border border-theme-sidebar-border bg-theme-bg-primary p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{answer.question || "回答"}</h3>
        <div className="flex gap-2">
          <Status value={getAnswerStatusLabel(answer.status)} />
          <Button disabled={blocked} onClick={onReanswer}>
            重新回答
          </Button>
        </div>
      </div>
      {answer.stale && (
        <Notice tone="warning">
          资料已变化：这是历史回答，引用仍指向回答时保存的证据快照。
        </Notice>
      )}
      {answer.newSources && (
        <Notice>
          固定范围中出现了新资料。新问题可检索当前资料；本条回答仍保留原快照。
        </Notice>
      )}
      {answer.status === "AWAITING_SOURCES" && (
        <Notice tone="warning">
          现有证据不足以回答。请补充资料或提出澄清问题。
        </Notice>
      )}
      {answer.status === "FAILED_INCOMPLETE" && (
        <Notice tone="error">
          回答服务中断，已保留部分输出。请检查服务状态后再重新回答。
        </Notice>
      )}
      {answer.missingInfo && (
        <p className="mt-3 rounded-lg bg-amber-900/20 p-3 text-sm">
          需要澄清：{answer.missingInfo}
        </p>
      )}
      {answer.error && (
        <p className="mt-3 text-sm text-red-300">服务错误：{answer.error}</p>
      )}
      <p className="mt-3 whitespace-pre-wrap text-sm">
        {answer.text || answer.partialText || "尚无可展示的回答文本。"}
      </p>
      {citations.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-semibold">证据来源</h4>
          {citations.map((citation, index) => (
            <Citation
              key={`${citation.id || citation.sourceId || index}-${index}`}
              citation={citation}
              answer={answer}
              meeting={meetings.find(
                (item) => String(item.id) === String(citation.meetingId)
              )}
            />
          ))}
        </div>
      )}
      {snapshots.length > 0 && citations.length === 0 && (
        <p className="mt-3 text-xs text-theme-text-secondary">
          此历史回答保存了证据快照，但没有当前可打开的引用条目。
        </p>
      )}
    </article>
  );
}

export function Citation({ citation, answer, meeting }) {
  const meetingId = citation.meetingId || citation.meeting?.id;
  const sourceId = citation.sourceId || citation.id;
  const workspace =
    citation.actualWorkspace ||
    citation.workspace ||
    (citation.workspaceId != null && citation.documentId
      ? { id: citation.workspaceId, documentId: citation.documentId }
      : null);
  const quote = citation.quote || citation.text || "未保存原文摘录";
  const sourceName =
    citation.name || citation.sourceName || citation.documentName || "来源";
  const location = citation.location || {};
  const locationText = getCitationLocationLabel(location);
  const citationSnapshot = asArray(answer?.sourceState?.citedSources).find(
    (item) =>
      item.sourceType === "WORKSPACE"
        ? String(item.workspaceId) === String(workspace?.id) &&
          String(item.documentId) === String(workspace?.documentId)
        : String(item.meetingId) === String(meetingId) &&
          String(item.id) === String(sourceId)
  );
  const meetingTitle = meeting?.title || citation.meetingName || "工作区来源";
  const meetingStartTime =
    meeting?.startTime ||
    citation.meetingStartTime ||
    citation.meeting?.startTime;
  return (
    <div className="rounded-lg border border-theme-sidebar-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{sourceName}</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Status value={citation.reviewStatus} />
          <CoverageBadge coverage={citation.coverage} />
        </div>
      </div>
      <p className="mt-1 text-xs text-theme-text-secondary">
        {meetingTitle} · {formatDate(meetingStartTime)} · {locationText}
        {workspace || citation.sourceType === "WORKSPACE"
          ? "（工作区来源仅支持文件级定位）"
          : citation.preciseLocation === false
            ? "（来源未提供精确位置）"
            : ""}
      </p>
      <blockquote className="mt-2 border-l-2 border-blue-400 pl-3 text-theme-text-secondary">
        {quote}
      </blockquote>
      <div className="mt-2 flex flex-wrap gap-2">
        {meetingId && sourceId && (
          <Link
            className="underline"
            to={paths.meetings.source(meetingId, sourceId)}
            state={{
              snapshot: {
                quote,
                sourceName,
                location,
                meetingTitle,
                meetingStartTime,
                coverage: citation.coverage,
                reviewStatus: citation.reviewStatus,
                citedSource: citationSnapshot,
                freshness: {
                  stale: answer?.stale,
                  newSources: answer?.newSources,
                },
              },
            }}
          >
            查看回答时的引用快照和当前原文
          </Link>
        )}
        {workspace?.id && workspace?.documentId && (
          <Link
            className="underline"
            to={paths.meetings.source(workspace.id, workspace.documentId)}
            state={{
              workspace,
              snapshot: getWorkspaceCitationSnapshot({
                quote,
                sourceName,
                location,
                citedSource: citationSnapshot,
                freshness: {
                  stale: answer?.stale,
                  newSources: answer?.newSources,
                },
              }),
            }}
          >
            查看工作区文件引用
          </Link>
        )}
      </div>
    </div>
  );
}
