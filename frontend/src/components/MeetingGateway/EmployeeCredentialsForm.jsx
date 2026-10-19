import React, { useState } from "react";
import { storeEmployeeLogin } from "@/models/meetingGateway";

const errorMessage = (error) => {
  if (error?.message === "MGW_LOGIN_REJECTED") return "账号或密码不正确。";
  if (error?.message === "MGW_RATE_LIMITED")
    return "尝试次数过多，请稍后再试。";
  if (error?.message === "MGW_DEPENDENCY_NOT_READY")
    return "会议账号登录服务暂不可用，请联系管理员。";
  return "会议账号登录失败，请稍后重试。";
};

export default function EmployeeCredentialsForm({
  client,
  heading = "会议员工账号",
  onComplete,
  onCancel,
}) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const submittedAccount = account;
    const submittedPassword = password;
    setAccount("");
    setPassword("");
    event.currentTarget.reset();
    setError("");
    setBusy(true);
    try {
      const completion = await client.employeeLogin(
        submittedAccount,
        submittedPassword
      );
      onComplete?.(storeEmployeeLogin(completion));
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full space-y-3">
      <h2 className="text-base font-semibold text-theme-text-primary">
        {heading}
      </h2>
      <label className="block text-sm text-theme-text-primary">
        账号
        <input
          autoComplete="username"
          className="mt-1 w-full rounded-lg border border-theme-bg-secondary bg-theme-bg-primary px-3 py-2"
          disabled={busy}
          name="account"
          onChange={(event) => setAccount(event.target.value)}
          required
          value={account}
        />
      </label>
      <label className="block text-sm text-theme-text-primary">
        密码
        <input
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-theme-bg-secondary bg-theme-bg-primary px-3 py-2"
          disabled={busy}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            className="rounded-lg px-3 py-2 text-sm"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            返回
          </button>
        )}
        <button
          className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy || !account || !password}
          type="submit"
        >
          {busy ? "正在验证…" : "验证员工账号"}
        </button>
      </div>
    </form>
  );
}
