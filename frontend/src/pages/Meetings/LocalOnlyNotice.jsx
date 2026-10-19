import React from "react";
import { Button } from "./MeetingsUI";

export default function LocalOnlyNotice({
  onRescan,
  available = false,
  loading = false,
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-500/40 bg-theme-bg-secondary p-3 text-sm text-theme-text-primary"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          认证结果丢失，仅可检索本地已有会议数据；重新扫码后恢复远端访问
        </span>
        <Button
          onClick={onRescan}
          disabled={!available || loading}
          aria-label="重新扫码恢复远端访问"
        >
          {loading ? "正在跳转…" : "重新扫码"}
        </Button>
      </div>
      {!available && (
        <p className="mt-2 text-xs">
          企业微信认证服务暂不可用。远端访问恢复前，仍可检索已有的本地会议数据。
        </p>
      )}
    </div>
  );
}
