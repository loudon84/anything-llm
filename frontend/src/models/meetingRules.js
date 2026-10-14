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
  return (
    meeting?.reviewStatus === "DRAFT" &&
    ["SUPPLEMENT_FILE", "SUPPLEMENT_TEXT"].includes(source?.sourceType) &&
    !source?.deletedAt
  );
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
