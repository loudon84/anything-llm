import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
export {
  canSupplementSource,
  getMeetingSelectionState,
} from "./meetingRules.js";

const root = `${API_BASE}/meetings`;

export async function meetingRequest(path, options = {}) {
  const response = await fetch(`${root}${path}`, {
    ...options,
    headers: {
      ...baseHeaders(),
      ...(typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(
      response.status >= 500
        ? "会议服务暂时不可用，请稍后重试。"
        : body?.error || `请求失败（${response.status}）`
    );
  }
  if (!body || typeof body !== "object")
    throw new Error("会议服务返回了无效响应。");
  if (body.error) throw new Error(body.error);
  return body;
}

function queryString(values = {}) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      query.set(key, value);
  });
  const result = query.toString();
  return result ? `?${result}` : "";
}

export const Meetings = {
  async config() {
    return (await meetingRequest("/config")).config;
  },
  async saveConfig(data) {
    return (
      await meetingRequest("/config", {
        method: "PUT",
        body: JSON.stringify(data),
      })
    ).config;
  },
  async list(params = {}) {
    return (await meetingRequest(queryString(params))).meetings;
  },
  async remote(params = {}) {
    return meetingRequest(`/remote${queryString(params)}`);
  },
  async manifest(externalId, params = {}) {
    return (
      await meetingRequest(
        `/remote/${encodeURIComponent(externalId)}/manifest${queryString(params)}`
      )
    ).manifest;
  },
  async importMeeting(data) {
    return (
      await meetingRequest("/import", {
        method: "POST",
        body: JSON.stringify(data),
      })
    ).job;
  },
  async jobs(params = {}) {
    return (await meetingRequest(`/jobs${queryString(params)}`)).jobs;
  },
  async workspaces() {
    const response = await fetch(`${API_BASE}/workspaces`, {
      headers: baseHeaders(),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok)
      throw new Error(
        response.status >= 500
          ? "工作区列表暂时不可用。"
          : body?.error || "无法读取工作区列表。"
      );
    if (!Array.isArray(body?.workspaces))
      throw new Error("工作区服务返回了无效响应。");
    return body.workspaces;
  },
  async retryJob(id) {
    return (
      await meetingRequest(`/jobs/${encodeURIComponent(id)}/retry`, {
        method: "POST",
      })
    ).job;
  },
  async detail(id) {
    return meetingRequest(`/${encodeURIComponent(id)}`);
  },
  async updateContent(id, data) {
    return (
      await meetingRequest(`/${encodeURIComponent(id)}/content`, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    ).meeting;
  },
  async approve(id) {
    return (
      await meetingRequest(`/${encodeURIComponent(id)}/approve`, {
        method: "POST",
      })
    ).meeting;
  },
  async removeMeeting(id) {
    return (
      await meetingRequest(`/${encodeURIComponent(id)}`, { method: "DELETE" })
    ).meeting;
  },
  async reindex(id) {
    return (
      await meetingRequest(`/${encodeURIComponent(id)}/reindex`, {
        method: "POST",
      })
    ).job;
  },
  async addFile(id, file) {
    const form = new FormData();
    form.append("file", file);
    return (
      await meetingRequest(`/${encodeURIComponent(id)}/sources/file`, {
        method: "POST",
        body: form,
      })
    ).source;
  },
  async addText(id, name, text) {
    return (
      await meetingRequest(`/${encodeURIComponent(id)}/sources/text`, {
        method: "POST",
        body: JSON.stringify({ name, text }),
      })
    ).source;
  },
  async deleteSource(meetingId, sourceId) {
    return (
      await meetingRequest(
        `/${encodeURIComponent(meetingId)}/sources/${encodeURIComponent(sourceId)}`,
        { method: "DELETE" }
      )
    ).source;
  },
  async retrySource(meetingId, sourceId) {
    return (
      await meetingRequest(
        `/${encodeURIComponent(meetingId)}/sources/${encodeURIComponent(sourceId)}/retry`,
        { method: "POST" }
      )
    ).job;
  },
  async segments(meetingId, sourceId) {
    return meetingRequest(
      `/${encodeURIComponent(meetingId)}/sources/${encodeURIComponent(sourceId)}/segments`
    );
  },
  fileUrl(meetingId, sourceId, download = false) {
    return `${root}/${encodeURIComponent(meetingId)}/sources/${encodeURIComponent(sourceId)}/file${download ? "?download=1" : ""}`;
  },
  async createConversation(meetingIds, workspaceIds) {
    return (
      await meetingRequest("/conversations", {
        method: "POST",
        body: JSON.stringify({ meetingIds, workspaceIds }),
      })
    ).conversation;
  },
  async conversation(id) {
    return (await meetingRequest(`/conversations/${encodeURIComponent(id)}`))
      .conversation;
  },
  async answers(id) {
    return (
      await meetingRequest(`/conversations/${encodeURIComponent(id)}/answers`)
    ).answers;
  },
  async ask(id, data) {
    return (
      await meetingRequest(
        `/conversations/${encodeURIComponent(id)}/questions`,
        { method: "POST", body: JSON.stringify(data) }
      )
    ).answer;
  },
  workspaceFileUrl(workspaceId, documentId, download = false) {
    return `${root}/workspaces/${encodeURIComponent(workspaceId)}/sources/${encodeURIComponent(documentId)}/file${download ? "?download=1" : ""}`;
  },
};

export async function fetchMeetingBlob(url) {
  const response = await fetch(url, { headers: baseHeaders() });
  if (!response.ok) throw new Error("无法读取文件，请检查访问权限后重试。");
  return response.blob();
}
