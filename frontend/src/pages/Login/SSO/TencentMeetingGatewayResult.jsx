import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  createMeetingGatewayClient,
  parseTencentConnectionReturn,
} from "@/models/meetingGateway";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import paths from "@/utils/paths";

export default function TencentMeetingGatewayResult() {
  const location = useLocation();
  const client = useMemo(
    () =>
      createMeetingGatewayClient({
        apiBase: API_BASE,
        getAuthHeaders: baseHeaders,
      }),
    []
  );
  const connectionIdRef = useRef(undefined);
  const popupReturnSent = useRef(false);
  const directConfirmationStarted = useRef(false);
  const [result, setResult] = useState("checking");

  useEffect(() => {
    if (connectionIdRef.current === undefined) {
      connectionIdRef.current =
        parseTencentConnectionReturn(location.search) || null;
      // Remove the callback identifier before any authenticated request or render.
      window.history.replaceState(null, "", location.pathname);
    }
    const connectionId = connectionIdRef.current;
    if (!connectionId) {
      setResult("invalid");
      return undefined;
    }

    const opener = window.opener;
    if (opener && !opener.closed) {
      const onMessage = (event) => {
        if (event.origin !== window.location.origin || event.source !== opener)
          return;
        const data = event.data;
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          Object.keys(data).length !== 2 ||
          data.type !== "meeting-gateway-connection-result" ||
          !["ACTIVE", "FAILED"].includes(data.status)
        )
          return;
        setResult(data.status === "ACTIVE" ? "active" : "failed");
        window.removeEventListener("message", onMessage);
      };
      window.addEventListener("message", onMessage);
      if (!popupReturnSent.current) {
        popupReturnSent.current = true;
        opener.postMessage(
          { type: "meeting-gateway-connection-return", connectionId },
          window.location.origin
        );
      }
      return () => {
        window.removeEventListener("message", onMessage);
      };
    }

    // Direct callback visits still ask the BFF to verify. A missing bridge
    // cookie produces a safe failure and never treats the query as success.
    if (!directConfirmationStarted.current) {
      directConfirmationStarted.current = true;
      client
        .confirmConnection(connectionId)
        .then(({ status }) =>
          setResult(status === "ACTIVE" ? "active" : "failed")
        )
        .catch(() => setResult("failed"));
    }
    return undefined;
  }, [client, location.pathname, location.search]);

  const copy = {
    checking: "正在向会议服务核验腾讯授权状态…",
    active: "腾讯会议连接已由会议服务确认。",
    failed: "会议服务未确认这次腾讯授权。请返回会议中心查看连接状态。",
    invalid: "授权返回参数无效。请从会议中心重新发起授权。",
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-theme-bg-primary p-6 text-theme-text-primary">
      <section className="w-full max-w-lg space-y-4 rounded-xl border border-theme-sidebar-border bg-theme-bg-secondary p-6">
        <h1 className="text-xl font-semibold">腾讯会议连接授权</h1>
        <p role="status">{copy[result]}</p>
        {result !== "checking" && (
          <a className="underline" href={paths.meetings.home()}>
            返回会议中心
          </a>
        )}
      </section>
    </main>
  );
}
