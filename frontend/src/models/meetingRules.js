export function getMeetingSelectionState(meetings, selectedIds) {
  const selected = meetings.filter(({ id }) => selectedIds.has(id));
  const unavailableIds = selected
    .filter(({ retrievalStatus }) => retrievalStatus !== "AVAILABLE")
    .map(({ id }) => id);
  const count = selected.length;
  return {
    count,
    overLimit: count > 10,
    unavailableIds,
    canStart: count > 0 && count <= 10 && unavailableIds.length === 0,
  };
}

export function canSupplementSource(meeting, source) {
  return canDeleteSupplement(meeting, source);
}

export function canDeleteSupplement(meeting, source) {
  if (
    source?.deletedAt ||
    !["SUPPLEMENT_FILE", "SUPPLEMENT_TEXT"].includes(source?.sourceType)
  )
    return false;
  return source.sourceType === "SUPPLEMENT_TEXT"
    ? ["DRAFT", "APPROVED"].includes(meeting?.reviewStatus)
    : meeting?.reviewStatus === "DRAFT";
}

export function getMeetingActionCapabilities(meeting) {
  const review = meeting?.reviewStatus;
  return {
    editContent: ["DRAFT", "APPROVED"].includes(review),
    addSupplementText: ["DRAFT", "APPROVED"].includes(review),
    addSupplementFile: review === "DRAFT",
    approve: review === "DRAFT" && meeting?.retrievalStatus === "AVAILABLE",
    deleteMeeting: review === "DRAFT",
  };
}

export function getRemoteMeetingPage(response) {
  const page = response?.meetings;
  if (!page || !Array.isArray(page.items))
    throw new Error("腾讯会议列表返回了无效响应。");
  return { items: page.items, nextCursor: page.nextCursor || "" };
}

export function validateMeetingImport({
  manifest,
  attachments = [],
  from,
  to,
  discoveryStart,
  discoveryEnd,
}) {
  const errors = [];
  if (
    !discoveryStart ||
    !discoveryEnd ||
    Number.isNaN(Date.parse(discoveryStart)) ||
    Number.isNaN(Date.parse(discoveryEnd)) ||
    new Date(discoveryEnd) <= new Date(discoveryStart)
  ) {
    errors.push("会议导入必须保留有效的发现日期范围。");
  }
  if (attachments.length > 20) errors.push("每场会议最多选择 20 个附件。");
  if (
    attachments.some(
      (file) =>
        file.bytes != null &&
        (!Number.isFinite(Number(file.bytes)) ||
          Number(file.bytes) < 0 ||
          Number(file.bytes) > 100_000_000)
    )
  ) {
    errors.push("附件大小未知或超过 100 MB，请取消选择后再继续。");
  }
  if (
    attachments.reduce((sum, file) => sum + Number(file.bytes || 0), 0) >
    500_000_000
  ) {
    errors.push("所选附件合计不能超过 500 MB。");
  }
  const capability = manifest?.capabilities?.transcript;
  const transcriptSelected =
    capability === "supported" || capability?.status === "supported";
  const duration = Number(manifest?.transcriptDurationMs);
  const start = from === "" || from == null ? undefined : Number(from);
  const end = to === "" || to == null ? undefined : Number(to);
  if (start !== undefined && (!Number.isFinite(start) || start < 0))
    errors.push("开始偏移必须是非负毫秒数。");
  if (end !== undefined && (!Number.isFinite(end) || end < 0))
    errors.push("结束偏移必须是非负毫秒数。");
  if (transcriptSelected) {
    const effectiveEnd = end ?? duration;
    const effectiveStart = start ?? 0;
    if (
      (start !== undefined && end === undefined) ||
      !Number.isFinite(effectiveEnd) ||
      effectiveEnd <= effectiveStart ||
      effectiveEnd - effectiveStart > 3 * 60 * 60 * 1000
    ) {
      errors.push("请选择完整有效的转写时间范围，单次最多 3 小时。");
    }
  } else if (start !== undefined || end !== undefined) {
    errors.push("当前清单没有可选转写，不能设置转写偏移。");
  }
  return {
    valid: errors.length === 0,
    errors,
    scope: {
      startTime: discoveryStart,
      endTime: discoveryEnd,
      ...(start === undefined ? {} : { from: start }),
      ...(end === undefined ? {} : { to: end }),
      attachmentIds: attachments.map(({ externalFileId }) => externalFileId),
    },
  };
}

export function compareCitedSource(cited, current) {
  if (!current || current.deletedAt || current.deleted) return "deleted";
  if (!cited) return "unavailable";
  if (
    cited?.contentHash !== current.contentHash ||
    cited?.activeHash !== current.activeHash ||
    cited?.updatedAt !== current.updatedAt
  )
    return "modified";
  return "unchanged";
}

export function getReanswerDraft(answer) {
  return {
    reanswerId: String(answer?.id || ""),
    question: answer?.question || "",
    clarification: answer?.clarification || "",
  };
}

export function getMeetingDraftValues(current, meeting, preserveDraft = false) {
  if (preserveDraft) return current;
  return {
    summary: meeting?.summary || "",
    transcript: meeting?.transcript || "",
  };
}

export function getUploadBatchFeedback(succeeded, total, error = "") {
  return {
    error,
    notice: error
      ? succeeded
        ? `已成功提交 ${succeeded}/${total} 个文件；失败项可单独重试上传。`
        : ""
      : `已提交 ${succeeded} 个补充文件，解析任务将在后台继续。`,
  };
}

export function getPollingListParams(activeQuery) {
  return { ...activeQuery };
}

export function getCitationLocationLabel(location = {}) {
  if (location.paragraph != null) return `第 ${location.paragraph} 段`;
  if (location.page != null) return `第 ${location.page} 页`;
  if (location.slide != null) return `第 ${location.slide} 张幻灯片`;
  if (location.cell) return `单元格 ${location.cell}`;
  if (location.startMs != null)
    return `转写 ${Math.floor(location.startMs / 1000)} 秒`;
  return "未提供精确位置";
}

export function getDateBounds(from, to) {
  if (!from || !to) throw new Error("请选择开始和结束日期。");
  const businessDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("请选择有效日期。");
    const dateOnly = new Date(`${value}T00:00:00Z`);
    if (
      Number.isNaN(dateOnly.getTime()) ||
      dateOnly.toISOString().slice(0, 10) !== value
    )
      throw new Error("请选择有效日期。");
    return new Date(`${value}T00:00:00+08:00`);
  };
  const start = businessDate(from);
  const inclusiveEnd = businessDate(to);
  if (start > inclusiveEnd) throw new Error("结束日期必须晚于或等于开始日期。");
  return {
    from: start.toISOString(),
    to: new Date(inclusiveEnd.getTime() + 86_400_000).toISOString(),
  };
}
