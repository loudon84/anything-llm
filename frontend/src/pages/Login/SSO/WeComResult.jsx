import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FullScreenLoader } from "@/components/Preloader";
import { createWeComAuthClient } from "@/models/wecomAuth";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import paths from "@/utils/paths";
import LocalOnlyNotice from "@/pages/Meetings/LocalOnlyNotice";

export default function WeComResult() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [result, setResult] = useState(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const client = useMemo(
    () =>
      createWeComAuthClient({
        apiBase: API_BASE,
        getAuthHeaders: baseHeaders,
      }),
    []
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;
    Promise.all([
      client.completeFromCallback(),
      client.getConfig().catch(() => ({ available: false })),
    ]).then(([completion, config]) => {
      if (!active) return;
      setResult(completion);
      setAvailable(config.available === true);
    });
    return () => {
      active = false;
    };
  }, [client]);

  async function rescan() {
    if (!available || busy) return;
    setBusy(true);
    try {
      await client.start();
    } catch {
      setResult((current) => ({ ...current, errorCode: "START_FAILED" }));
      setBusy(false);
    }
  }

  if (!result) return <FullScreenLoader />;

  const state = result.state;
  const localOnly =
    !result.success &&
    state?.authenticated === true &&
    state?.remoteAccessMode === "LOCAL_ONLY";
  const gatewaySessionReady =
    !result.success &&
    state?.authenticated === true &&
    state?.remoteAccessMode === "GATEWAY_ENABLED";
  const completeUser = result.user || state?.user;

  return (
    <main className="flex min-h-screen items-center justify-center bg-theme-bg-primary p-4 text-theme-text-primary">
      <section className="w-full max-w-xl space-y-4 rounded-xl border border-theme-sidebar-border bg-theme-bg-secondary p-6">
        <h1 className="text-xl font-semibold">企业微信登录结果</h1>
        {result.success || gatewaySessionReady ? (
          <div className="space-y-2" role="status">
            <p>
              {result.success
                ? "已通过企业微信验证并同步本地账号。"
                : "当前本地登录会话有效，可继续查看会议数据。"}
            </p>
            {completeUser?.displayName && (
              <p className="text-sm text-theme-text-secondary">
                {completeUser.displayName}
              </p>
            )}
            <button
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={() => navigate(paths.meetings.home(), { replace: true })}
            >
              查看本地会议
            </button>
          </div>
        ) : localOnly ? (
          <div className="space-y-3">
            <LocalOnlyNotice
              available={available}
              loading={busy}
              onRescan={rescan}
            />
            <button
              className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
              onClick={() => navigate(paths.meetings.home(), { replace: true })}
            >
              继续检索本地会议
            </button>
          </div>
        ) : (
          <div className="space-y-3" role="alert">
            <p>未能完成企业微信登录。请重新扫码；此状态不表示缺少会议权限。</p>
            {result.errorCode === "START_FAILED" && (
              <p className="text-sm text-red-300">
                认证服务暂时不可用，请稍后重试。
              </p>
            )}
            <button
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={!available || busy}
              onClick={rescan}
            >
              {busy ? "正在跳转…" : "重新扫码"}
            </button>
            <button
              className="rounded-lg bg-theme-bg-sidebar px-3 py-2 text-sm"
              onClick={() => navigate(paths.login(), { replace: true })}
            >
              返回登录
            </button>
          </div>
        )}
        <p className="text-xs text-theme-text-secondary">
          登录结果由本地认证服务确认；请勿将地址栏内容当作登录凭证。
        </p>
      </section>
    </main>
  );
}
