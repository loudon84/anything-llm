import React, { useEffect, useState } from "react";
import { Meetings } from "@/models/meetings";
import { Button, Field, inputClass, Notice, Page, Panel } from "./MeetingsUI";

export default function MeetingSettings() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({
    name: "Tencent Meeting",
    appId: "",
    sdkId: "",
    userId: "",
    operatorId: "",
    operatorIdType: "1",
    secretId: "",
    secretKey: "",
    ocrUrl: "",
    ocrToken: "",
    transcript: "",
    summary: "",
    attachments: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    Meetings.config()
      .then((value) => {
        if (!live) return;
        setConfig(value);
        if (value)
          setForm((current) => ({
            ...current,
            name: value.name || current.name,
            appId: value.appId || "",
            sdkId: value.sdkId || "",
            userId: value.userId || "",
            operatorId: value.operatorId || "",
            operatorIdType: String(value.operatorIdType ?? 1),
            ocrUrl: value.services?.ocr?.url || "",
            transcript:
              value.capabilities?.transcript?.status ||
              value.capabilities?.transcript ||
              "",
            summary:
              value.capabilities?.summary?.status ||
              value.capabilities?.summary ||
              "",
            attachments:
              value.capabilities?.attachments?.status ||
              value.capabilities?.attachments ||
              "",
          }));
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await Meetings.saveConfig({
        ...(config?.id ? { id: config.id } : {}),
        name: form.name,
        appId: form.appId,
        sdkId: form.sdkId,
        userId: form.userId,
        operatorId: form.operatorId,
        operatorIdType: Number(form.operatorIdType) || 1,
        secretId: form.secretId,
        secretKey: form.secretKey,
        capabilities: {
          transcript: form.transcript,
          summary: form.summary,
          attachments: form.attachments,
        },
        services: { ocr: { url: form.ocrUrl, token: form.ocrToken } },
      });
      setConfig(saved);
      setForm((current) => ({
        ...current,
        secretId: "",
        secretKey: "",
        ocrToken: "",
      }));
      setNotice("连接配置已保存。密钥已清空；留空保存时会保留已存密钥。");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="会议连接设置"
      description="管理员专用。保存后服务端只返回密钥存在状态，不会再次显示密钥。"
    >
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Panel title="腾讯会议与解析服务">
        {loading ? (
          <p>正在读取配置…</p>
        ) : (
          <form onSubmit={save} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="连接名称">
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => change("name", e.target.value)}
                  required
                />
              </Field>
              <Field label="App ID">
                <input
                  className={inputClass}
                  value={form.appId}
                  onChange={(e) => change("appId", e.target.value)}
                />
              </Field>
              <Field label="SDK ID">
                <input
                  className={inputClass}
                  value={form.sdkId}
                  onChange={(e) => change("sdkId", e.target.value)}
                />
              </Field>
              <Field label="用户 ID">
                <input
                  className={inputClass}
                  value={form.userId}
                  onChange={(e) => change("userId", e.target.value)}
                />
              </Field>
              <Field label="操作员 ID">
                <input
                  className={inputClass}
                  value={form.operatorId}
                  onChange={(e) => change("operatorId", e.target.value)}
                />
              </Field>
              <Field label="操作员 ID 类型">
                <input
                  type="number"
                  className={inputClass}
                  value={form.operatorIdType}
                  onChange={(e) => change("operatorIdType", e.target.value)}
                />
              </Field>
              <Field
                label="Secret ID"
                hint={`存储状态：${config?.credentialHints?.secretIdPresent ? "已配置" : "未配置"}。留空会保留原密钥。`}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  value={form.secretId}
                  onChange={(e) => change("secretId", e.target.value)}
                  placeholder={
                    config?.credentialHints?.secretIdPresent
                      ? "已保存，输入新值以更换"
                      : "输入 Secret ID"
                  }
                />
              </Field>
              <Field
                label="Secret Key"
                hint={`存储状态：${config?.credentialHints?.secretKeyPresent ? "已配置" : "未配置"}。留空会保留原密钥。`}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  value={form.secretKey}
                  onChange={(e) => change("secretKey", e.target.value)}
                  placeholder={
                    config?.credentialHints?.secretKeyPresent
                      ? "已保存，输入新值以更换"
                      : "输入 Secret Key"
                  }
                />
              </Field>
              <Field label="OCR 服务地址">
                <input
                  type="url"
                  className={inputClass}
                  value={form.ocrUrl}
                  onChange={(e) => change("ocrUrl", e.target.value)}
                />
              </Field>
              <Field
                label="OCR 令牌"
                hint={`存储状态：${config?.services?.ocr?.tokenPresent ? "已配置" : "未配置"}。留空会保留原令牌。`}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  value={form.ocrToken}
                  onChange={(e) => change("ocrToken", e.target.value)}
                  placeholder={
                    config?.services?.ocr?.tokenPresent
                      ? "已保存，输入新值以更换"
                      : "输入 OCR 令牌"
                  }
                />
              </Field>
            </div>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 font-medium">
                租户内容能力（supported / unsupported / unknown）
              </legend>
              {[
                ["transcript", "转写"],
                ["summary", "摘要"],
                ["attachments", "附件"],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <select
                    className={inputClass}
                    value={form[key]}
                    onChange={(e) => change(key, e.target.value)}
                  >
                    <option value="">未知（运行时探测）</option>
                    <option value="supported">支持</option>
                    <option value="unsupported">不支持</option>
                  </select>
                </Field>
              ))}
            </fieldset>
            <div className="flex items-center gap-3">
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "正在保存…" : "保存设置"}
              </Button>
              {config && (
                <span className="text-sm text-theme-text-secondary">
                  {config.configured ? "连接凭据已配置" : "尚未配置连接凭据"}
                </span>
              )}
            </div>
          </form>
        )}
      </Panel>
    </Page>
  );
}
