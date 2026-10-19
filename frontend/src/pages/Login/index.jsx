import React, { useEffect, useMemo, useState } from "react";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { FullScreenLoader } from "@/components/Preloader";
import { Navigate } from "react-router-dom";
import { createWeComAuthClient, resolveWeComView } from "@/models/wecomAuth";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import paths from "@/utils/paths";
import useQuery from "@/hooks/useQuery";
import useSimpleSSO from "@/hooks/useSimpleSSO";
import EmployeeLoginEntry from "@/components/MeetingGateway/EmployeeLoginEntry";

/**
 * Login page that handles both single and multi-user login.
 *
 * Existing password and Simple SSO flows remain available. WeCom auth is an
 * additive BFF flow and stays unavailable until the server reports readiness.
 */
export default function Login() {
  const query = useQuery();
  const { loading: ssoLoading, ssoConfig } = useSimpleSSO();
  const { loading, requiresAuth, mode } = usePasswordModal(!!query.get("nt"));

  if (loading || ssoLoading) return <FullScreenLoader />;

  // Preserve existing Simple SSO no-login behavior.
  if (ssoConfig.enabled && ssoConfig.noLogin) {
    if (!!ssoConfig.noLoginRedirect && !query.has("token"))
      return window.location.replace(ssoConfig.noLoginRedirect);
    return <Navigate to={paths.sso.login()} />;
  }

  if (requiresAuth === false) return <Navigate to={paths.home()} />;

  return (
    <>
      <PasswordModal mode={mode} />
      <WeComLoginEntry />
      <EmployeeLoginEntry multiUserMode={mode === "multi"} />
    </>
  );
}

function WeComLoginEntry() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const client = useMemo(
    () =>
      createWeComAuthClient({
        apiBase: API_BASE,
        getAuthHeaders: baseHeaders,
      }),
    []
  );

  useEffect(() => {
    let active = true;
    client
      .getConfig()
      .then((value) => active && setConfig(value))
      .catch(
        () =>
          active &&
          setConfig({
            enabled: false,
            available: false,
            reason: "DEPENDENCY_NOT_READY",
          })
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [client]);

  const view = resolveWeComView({
    authenticated: false,
    available: config?.available === true,
    reason: config?.reason,
  });

  async function start() {
    if (!view.canStartWeCom || starting) return;
    setStarting(true);
    setError(false);
    try {
      await client.start();
    } catch {
      setError(true);
      setStarting(false);
    }
  }

  return (
    <section className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[calc(100%-2rem)] max-w-md flex-col items-center gap-2 text-center">
      {error ? (
        <p className="rounded bg-zinc-950/90 px-3 py-2 text-sm text-red-200">
          企业微信登录暂时无法启动，请稍后重试。
        </p>
      ) : loading ? (
        <p className="rounded bg-zinc-950/90 px-3 py-2 text-sm text-zinc-200">
          正在检查企业微信登录服务…
        </p>
      ) : !view.canStartWeCom ? (
        <p className="rounded bg-zinc-950/90 px-3 py-2 text-sm text-zinc-200">
          {view.message}
        </p>
      ) : null}
      <button
        className="rounded-lg border border-white/20 bg-zinc-800 px-4 py-2 text-sm text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!view.canStartWeCom || starting || loading}
        onClick={start}
      >
        {starting ? "正在前往企业微信…" : "使用企业微信扫码登录"}
      </button>
    </section>
  );
}
