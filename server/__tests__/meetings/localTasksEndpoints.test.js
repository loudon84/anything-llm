jest.mock("../../models/systemSettings", () => ({
  SystemSettings: { isMultiUserMode: jest.fn(async () => true) },
}));

const { createMeetingsEndpoints } = require("../../endpoints/meetings");
const { MeetingError } = require("../../modules/meetings/errors");

function setup(endpointOptions = {}) {
  const routes = [];
  const router = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    router[method] = (path, middleware, handler) =>
      routes.push({ method, path, middleware, handler });
  }
  const prisma = {
    meetings: {
      findUnique: async ({ where }) => ({
        id: Number(where.id),
        deletedAt: null,
        reviewStatus: "DRAFT",
        retrievalStatus: "AVAILABLE",
        workspaceId: null,
        createdBy: 8,
      }),
      findMany: async ({ where } = {}) => {
        const ids = where?.id?.in || [];
        return ids.map((id) => ({
          id: Number(id),
          deletedAt: null,
          reviewStatus: "DRAFT",
          retrievalStatus: "AVAILABLE",
          workspaceId: null,
          createdBy: 8,
        }));
      },
    },
    meeting_connections: { findMany: async () => [] },
    meeting_sources: { findMany: async () => [] },
  };
  const runtime = {
    config: { getPublic: async () => null, save: async (value) => value },
    meetings: {
      list: async () => [],
      get: async () => ({ id: 1 }),
      softDelete: async () => ({}),
    },
    remote: { list: async () => [], manifest: async () => ({}) },
    sources: {},
    qa: {},
    queueImport: async () => ({}),
    listJobs: async () => [],
    meetingFilters: () => ({}),
    lookupWorkspace: async () => null,
  };
  createMeetingsEndpoints(router, {
    runtime,
    prisma,
    authenticate: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
    featureFlagReader: async () => false,
    ...endpointOptions,
  });
  return { routes };
}

async function invoke(
  route,
  {
    params = { id: "1" },
    body = {},
    query = {},
    user = { id: 8, role: "default" },
    authState = {
      authenticated: true,
      kind: "LEGACY_MULTI_USER",
      actor: { id: user?.id || 8, userId: user?.id || 8 },
      session: null,
      remoteAccessMode: null,
    },
    headers = {},
  } = {}
) {
  const request = {
    params,
    body,
    query,
    headers,
    header: (name) => headers[name] || headers[String(name).toLowerCase()] || null,
    get: (name) => headers[name] || headers[String(name).toLowerCase()] || null,
  };
  const response = {
    locals: { user, multiUserMode: true, meetingAuthState: authState },
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
  await route.handler(request, response);
  return response;
}

describe("local tasks / OA feature gate endpoints", () => {
  test("flag off → OA and create return FEATURE_DISABLED not 500", async () => {
    const { routes } = setup({
      featureFlagReader: async () => false,
      oaSearch: jest.fn(async () => {
        throw new Error("should not run");
      }),
      localTasksService: {
        createLocalTask: jest.fn(async () => {
          throw new Error("should not run");
        }),
        listLocalTasks: jest.fn(async () => ({ tasks: [], candidates: [] })),
      },
    });

    const oa = await invoke(
      routes.find(
        (item) => item.method === "get" && item.path === "/meetings/oa/people"
      ),
      { query: { q: "张三" } }
    );
    expect(oa.statusCode).toBe(403);
    expect(oa.value).toMatchObject({ code: "FEATURE_DISABLED" });
    expect(oa.statusCode).not.toBe(500);

    const create = await invoke(
      routes.find(
        (item) =>
          item.method === "post" && item.path === "/meetings/:id/local-tasks"
      ),
      {
        body: {
          candidateId: "c1",
          title: "t",
          assigneeKey: "E1",
          assigneeName: "A",
        },
      }
    );
    expect(create.statusCode).toBe(403);
    expect(create.value).toMatchObject({ code: "FEATURE_DISABLED" });
    expect(create.statusCode).not.toBe(500);
  });

  test("GET local-tasks returns empty disabled notice when flag off", async () => {
    const { routes } = setup({ featureFlagReader: async () => false });
    const response = await invoke(
      routes.find(
        (item) =>
          item.method === "get" && item.path === "/meetings/:id/local-tasks"
      )
    );
    expect(response.statusCode).toBe(200);
    expect(response.value).toEqual({
      tasks: [],
      disabled: true,
    });
  });

  test("flag on proxies OA search and creates local tasks", async () => {
    const createLocalTask = jest.fn(async () => ({
      id: 11,
      meetingId: 1,
      candidateId: "c1",
      title: "完成方案",
      status: "pending",
    }));
    const oaSearch = jest.fn(async () => [
      { fd_no: "E001", fd_name: "张三", fd_department: "研发" },
    ]);
    const { routes } = setup({
      featureFlagReader: async () => true,
      oaSearch,
      localTasksService: {
        createLocalTask,
        listLocalTasks: async () => ({
          tasks: [],
          candidates: [],
        }),
      },
    });

    const oa = await invoke(
      routes.find(
        (item) => item.method === "get" && item.path === "/meetings/oa/people"
      ),
      { query: { q: "张三" } }
    );
    expect(oa.statusCode).toBe(200);
    expect(oa.value.people).toHaveLength(1);
    expect(oaSearch).toHaveBeenCalledWith("张三");

    const created = await invoke(
      routes.find(
        (item) =>
          item.method === "post" && item.path === "/meetings/:id/local-tasks"
      ),
      {
        body: {
          candidateId: "c1",
          title: "完成方案",
          assigneeKey: "E001",
          assigneeName: "张三",
        },
        headers: { "Idempotency-Key": "k-1" },
      }
    );
    expect(created.statusCode).toBe(200);
    expect(created.value.task.id).toBe(11);
    expect(createLocalTask).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 1,
        candidateId: "c1",
        idempotencyKey: "k-1",
      })
    );
  });

  test("APPROVED writable denial returns MEETING_IMMUTABLE", async () => {
    const { routes } = setup({
      featureFlagReader: async () => true,
      meetingAuthAccess: {
        getRequestState: () => ({
          authenticated: true,
          kind: "LEGACY_MULTI_USER",
          actor: { id: 8, userId: 8 },
          session: null,
          remoteAccessMode: null,
        }),
        assertLocalMeetingReadable: async () => [1],
        assertMeetingWritable: async () => {
          throw new MeetingError(
            "Meeting content is immutable after approval",
            "MEETING_IMMUTABLE",
            409
          );
        },
        assertRemoteAllowed: () => {},
        filterLocalMeetings: async ({ meetings }) => meetings,
      },
      localTasksService: {
        createLocalTask: async () => {
          throw new Error("should not run after ACL");
        },
        listLocalTasks: async () => ({ tasks: [] }),
      },
    });

    const response = await invoke(
      routes.find(
        (item) =>
          item.method === "post" && item.path === "/meetings/:id/local-tasks"
      ),
      {
        body: {
          candidateId: "c1",
          title: "t",
          assigneeKey: "E1",
          assigneeName: "A",
        },
      }
    );
    expect(response.statusCode).toBe(409);
    expect(response.value.code).toBe("MEETING_IMMUTABLE");
  });
});
