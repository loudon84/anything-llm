import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmployeeCredentialsForm from "./EmployeeCredentialsForm";
import { createMeetingGatewayClient } from "@/models/meetingGateway";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import paths from "@/utils/paths";

export default function EmployeeLoginEntry({ multiUserMode = false }) {
  const navigate = useNavigate();
  const client = useMemo(
    () =>
      createMeetingGatewayClient({
        apiBase: API_BASE,
        getAuthHeaders: baseHeaders,
      }),
    []
  );
  const [readiness, setReadiness] = useState("checking");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!multiUserMode) return;
    let active = true;
    client
      .employeeLoginStatus()
      .then(
        ({ available }) =>
          active && setReadiness(available ? "ready" : "unavailable")
      )
      .catch(() => active && setReadiness("unavailable"));
    return () => {
      active = false;
    };
  }, [client, multiUserMode]);

  if (!multiUserMode) return null;

  return (
    <div className="fixed right-4 top-4 z-[60] max-w-xs text-right">
      {readiness === "ready" ? (
        <button
          className="rounded-lg border border-white/20 bg-zinc-800 px-3 py-2 text-sm text-white shadow-lg"
          onClick={() => setOpen(true)}
          type="button"
        >
          使用会议员工账号登录
        </button>
      ) : readiness === "checking" ? (
        <p className="rounded-lg bg-zinc-950/90 px-3 py-2 text-xs text-zinc-200">
          正在检查会议账号登录服务…
        </p>
      ) : (
        <p className="rounded-lg bg-zinc-950/90 px-3 py-2 text-xs text-zinc-200">
          会议员工账号登录服务尚未就绪
        </p>
      )}
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="会议员工账号登录"
        >
          <div className="w-full max-w-md rounded-xl bg-theme-bg-secondary p-5 text-left shadow-2xl">
            <EmployeeCredentialsForm
              client={client}
              onCancel={() => setOpen(false)}
              onComplete={() =>
                navigate(paths.meetings.home(), { replace: true })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
