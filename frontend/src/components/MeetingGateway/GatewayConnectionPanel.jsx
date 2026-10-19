import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import EmployeeCredentialsForm from "./EmployeeCredentialsForm";
import {
  createMeetingGatewayClient,
  openTencentAuthorization,
  resolveGatewayConnectionState,
} from "@/models/meetingGateway";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { Button, Panel } from "@/pages/Meetings/MeetingsUI";
import paths from "@/utils/paths";

const statusLabels = {
  ACTIVE: "已连接（服务端已验证）",
  PENDING: "等待腾讯会议授权完成",
  EXPIRED: "授权已过期",
  CANCELLED: "授权已取消",
  FAILED: "授权状态暂不可用或失败",
  AUTH_REQUIRED: "需要重新验证员工账号",
  NOT_CONNECTED: "尚未连接腾讯会议",
};

function validConnectionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export default function GatewayConnectionPanel({ authState }) {
  const client = useMemo(
    () =>
      createMeetingGatewayClient({
        apiBase: API_BASE,
        getAuthHeaders: baseHeaders,
      }),
    []
  );
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingExpiresAt, setPendingExpiresAt] = useState(null);
  const [clockNow, setClockNow] = useState(0);
  const [showReauth, setShowReauth] = useState(false);
  const popupRef = useRef(null);
  const handledReturns = useRef(new Set());
  const mode = authState?.remoteAccessMode;
  const isGatewayEmployee =
    authState?.authenticated === true && mode === "GATEWAY_ENABLED";
  const isLocalOnlyEmployee =
    authState?.authenticated === true && mode === "LOCAL_ONLY";
  const isEmployeeSession = isGatewayEmployee || isLocalOnlyEmployee;

  const refreshConnections = useCallback(async () => {
    if (!isGatewayEmployee) return;
    setLoading(true);
    setError("");
    try {
      await client.bootstrapSession();
      const result = await client.listConnections();
      setConnections(result.items);
      setReady(true);
    } catch {
      setReady(false);
      setError("腾讯会议授权状态暂时无法读取。请检查服务配置后重试。");
    } finally {
      setLoading(false);
    }
  }, [client, isGatewayEmployee]);

  useEffect(() => {
    if (isGatewayEmployee) refreshConnections();
  }, [isGatewayEmployee, refreshConnections]);

  useEffect(() => {
    if (!pendingExpiresAt) return undefined;
    setClockNow(Date.now());
    const delay = Math.max(0, Date.parse(pendingExpiresAt) - Date.now());
    const timer = window.setTimeout(() => setClockNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [pendingExpiresAt]);

  useEffect(() => {
    if (!isGatewayEmployee) return undefined;
    let active = true;
    async function onMessage(event) {
      if (
        event.origin !== window.location.origin ||
        event.source !== popupRef.current
      )
        return;
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.keys(data).length !== 2 ||
        data.type !== "meeting-gateway-connection-return" ||
        !validConnectionId(data.connectionId) ||
        handledReturns.current.has(data.connectionId)
      )
        return;
      handledReturns.current.add(data.connectionId);
      setBusy(true);
      setError("");
      try {
        // The initiating page owns the live strict bridge cookie and performs
        // the server-side ownership/status check for the callback identifier.
        const result = await client.confirmConnection(data.connectionId);
        if (!active || result.status !== "ACTIVE") return;
        setConnections((current) => [
          ...current.filter((item) => item.id !== data.connectionId),
          { id: data.connectionId, name: "腾讯会议", status: "ACTIVE" },
        ]);
        setPendingExpiresAt(null);
        popupRef.current?.postMessage(
          { type: "meeting-gateway-connection-result", status: "ACTIVE" },
          window.location.origin
        );
        refreshConnections();
      } catch {
        if (!active) return;
        setError("腾讯会议尚未确认授权。请检查授权窗口状态后重试。");
        popupRef.current?.postMessage(
          { type: "meeting-gateway-connection-result", status: "FAILED" },
          window.location.origin
        );
        refreshConnections();
      } finally {
        if (active) setBusy(false);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
    };
  }, [client, isGatewayEmployee, refreshConnections]);

  if (!isEmployeeSession) return null;

  const resolved = resolveGatewayConnectionState({
    employeeAuthenticated: isEmployeeSession,
    remoteAccessMode: mode,
    connections,
    pendingExpiresAt,
    now: clockNow,
    error: !!error && !ready,
  });
  const connectionStatus = busy ? "PENDING" : resolved.connectionStatus;

  async function startAuthorization() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await openTencentAuthorization({
        startOAuth: () => client.startOAuth(),
      });
      popupRef.current = result.popup;
      setPendingExpiresAt(result.expiresAt || null);
      handledReturns.current.clear();
    } catch (authorizationError) {
      setError(
        authorizationError?.message === "MGW_POPUP_BLOCKED"
          ? "浏览器阻止了授权窗口，请允许本站弹出窗口后重试。"
          : "腾讯会议授权暂时无法启动。请检查服务配置后重试。"
      );
    } finally {
      setBusy(false);
    }
  }

  function completeReauthentication() {
    window.location.assign(paths.meetings.home());
  }

  return (
    <Panel title="会议员工身份与腾讯连接">
      <div className="space-y-3 text-sm">
        <p>
          员工身份：
          {isGatewayEmployee
            ? "已通过会议员工账号验证"
            : "本地登录有效，远端访问需要重新验证"}
          {authState?.user?.username ? `（${authState.user.username}）` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>腾讯会议授权：</span>
          <span role="status">
            {statusLabels[connectionStatus] || "授权状态未知"}
          </span>
          {pendingExpiresAt && connectionStatus === "PENDING" && (
            <span className="text-xs text-theme-text-secondary">
              有效期至 {new Date(pendingExpiresAt).toLocaleString()}
            </span>
          )}
        </div>
        {connections.length > 0 && (
          <ul className="space-y-1 text-xs text-theme-text-secondary">
            {connections.map((connection) => (
              <li key={connection.id}>
                {connection.name} · {connection.status}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-red-500">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {isGatewayEmployee && (
            <>
              <Button
                onClick={startAuthorization}
                disabled={!ready || loading || busy}
              >
                {busy ? "正在处理…" : "授权腾讯会议连接"}
              </Button>
              <Button onClick={refreshConnections} disabled={loading || busy}>
                {loading ? "正在读取…" : "刷新授权状态"}
              </Button>
            </>
          )}
          {isLocalOnlyEmployee && (
            <Button onClick={() => setShowReauth((current) => !current)}>
              重新验证会议员工账号
            </Button>
          )}
        </div>
        {isLocalOnlyEmployee && (
          <p className="text-xs text-theme-text-secondary">
            本地已有会议搜索仍可使用；重新验证员工账号后才会恢复远端访问。
          </p>
        )}
        {showReauth && isLocalOnlyEmployee && (
          <div className="max-w-md rounded-lg border border-theme-sidebar-border p-4">
            <EmployeeCredentialsForm
              client={client}
              heading="重新验证会议员工账号"
              onCancel={() => setShowReauth(false)}
              onComplete={completeReauthentication}
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
