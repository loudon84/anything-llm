import React from "react";

export function Page({ title, description, children, actions }) {
  return (
    <main className="w-full h-full overflow-y-auto bg-theme-bg-primary text-theme-text-primary p-5 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {description && (
              <p className="mt-2 text-sm text-theme-text-secondary">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </main>
  );
}

export function Panel({ title, children, actions, className = "" }) {
  return (
    <section
      className={`rounded-xl border border-theme-sidebar-border bg-theme-bg-secondary p-4 md:p-5 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}) {
  const palette =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-500"
      : variant === "danger"
        ? "bg-red-700 text-white hover:bg-red-600 disabled:bg-slate-500"
        : "bg-theme-bg-sidebar hover:brightness-110 disabled:opacity-50";
  return (
    <button
      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed ${palette} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && (
        <span className="text-xs text-theme-text-secondary">{hint}</span>
      )}
    </label>
  );
}

export function Status({ value }) {
  const labels = {
    DRAFT: "草稿",
    APPROVED: "已审核",
    WAITING_CONTENT: "等待补充内容",
    AVAILABLE: "可问答",
    INDEXING: "索引中",
    INDEX_FAILED: "索引失败",
    DELETED: "已删除",
    PARTIAL: "部分导入",
    SUCCESS: "完成",
    FAILED: "失败",
    CREATED: "排队中",
    PROCESSING: "处理中",
  };
  return (
    <span className="inline-flex rounded-full bg-theme-bg-sidebar px-2.5 py-1 text-xs">
      {labels[value] || value || "未知"}
    </span>
  );
}

export function Notice({ children, tone = "info" }) {
  const colors =
    tone === "error"
      ? "border-red-500/40 bg-red-950/30 text-red-200"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-950/20 text-amber-100"
        : "border-blue-500/30 bg-blue-950/20 text-theme-text-primary";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm ${colors}`}
    >
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-theme-sidebar-border bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary";

export function formatDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Shanghai",
      }).format(date);
}
