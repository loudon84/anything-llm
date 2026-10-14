jest.mock("../../models/systemSettings", () => ({
  SystemSettings: { isMultiUserMode: jest.fn(async () => true) },
}));

const {
  createMeetingsEndpoints,
  MAX_UPLOAD_BYTES,
} = require("../../endpoints/meetings");
const { MeetingError } = require("../../modules/meetings/errors");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { SystemSettings } = require("../../models/systemSettings");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");

function setup(
  runtimeOverrides = {},
  prismaOverrides = {},
  endpointOptions = {}
) {
  const routes = [];
  const router = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    router[method] = (path, middleware, handler) =>
      routes.push({ method, path, middleware, handler });
  }
  const prisma = {
    meeting_connections: { findMany: async () => [] },
    meeting_sources: { findMany: async () => [] },
    ...prismaOverrides,
  };
  const runtime = {
    config: { getPublic: async () => null, save: async (value) => value },
    remote: {
      list: async () => [],
      manifest: async () => ({ attachments: [] }),
    },
    meetings: {
      list: async () => [],
      get: async () => ({ id: 1 }),
      revise: async () => ({}),
      approve: async () => ({}),
      softDelete: async () => ({}),
    },
    jobs: { retry: async () => ({ id: 1 }) },
    qa: {
      createConversation: async () => ({}),
      getConversation: async () => ({}),
      ask: async () => ({}),
      history: async () => [],
    },
    sources: {
      addText: async () => ({}),
      remove: async () => ({}),
      retry: async () => ({}),
      getSource: async () => ({}),
      getArchivedSource: async () => ({}),
    },
    queueImport: async () => ({ id: 1, status: "CREATED" }),
    requestReindex: async () => ({ id: 2, status: "CREATED" }),
    listJobs: async () => [],
    meetingFilters: () => ({}),
    upload: jest.fn(async () => ({ id: 3 })),
    lookupWorkspace: async () => null,
    ...runtimeOverrides,
  };
  const auth = (_req, _res, next) => next();
  const admin = (_req, _res, next) => next();
  createMeetingsEndpoints(router, {
    runtime,
    prisma,
    authenticate: auth,
    requireAdmin: admin,
    uploadRoot: require("path").join(__dirname, ".tmp-meeting-uploads"),
    ...endpointOptions,
  });
  return { routes, runtime, prisma };
}

async function invoke(
  route,
  {
    params = {},
    body = {},
    query = {},
    user = { id: 8, role: "default" },
    file,
  } = {}
) {
  const request = { params, body, query, file, header: () => null };
  const response = {
    locals: { user, multiUserMode: true },
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

async function invokeMiddlewareChain(route, options = {}) {
  const params = options.params || {};
  const body = options.body || {};
  const request = {
    params,
    body,
    query: {},
    header: () => options.authorization || null,
  };
  const response = {
    locals: {},
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.value = value;
      this.finished = true;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      this.value = String(code);
      this.finished = true;
      return this;
    },
    end() {
      this.finished = true;
      return this;
    },
  };
  const middleware = route.middleware;
  const dispatch = (index) => {
    if (response.finished) return Promise.resolve();
    if (index >= middleware.length) return route.handler(request, response);
    return new Promise((resolve, reject) => {
      let settled = false;
      const next = (error) => {
        if (settled) return;
        settled = true;
        if (error) return reject(error);
        Promise.resolve(dispatch(index + 1)).then(resolve, reject);
      };
      Promise.resolve(middleware[index](request, response, next))
        .then(() => {
          if (response.finished && !settled) {
            settled = true;
            resolve();
          }
        })
        .catch(reject);
    });
  };
  await dispatch(0);
  return response;
}

describe("authenticated meeting endpoints", () => {
  test("wraps the actual authentication denial in the stable JSON envelope", async () => {
    SystemSettings.isMultiUserMode.mockResolvedValue(true);
    const { routes } = setup({}, {}, { authenticate: validatedRequest });
    const route = routes.find(
      (item) => item.method === "get" && item.path === "/meetings/config"
    );

    const response = await invokeMiddlewareChain(route);

    expect(response.statusCode).toBe(401);
    expect(response.value).toEqual({
      error: "No auth token found.",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  test("wraps the actual admin role denial without bypassing the role check", async () => {
    SystemSettings.isMultiUserMode.mockResolvedValue(true);
    const authenticateAsEmployee = (_req, res, next) => {
      res.locals.multiUserMode = true;
      res.locals.user = { id: 8, role: ROLES.default };
      next();
    };
    const { routes } = setup(
      {},
      {},
      {
        authenticate: authenticateAsEmployee,
        requireAdmin: flexUserRoleValid([ROLES.admin]),
      }
    );
    const route = routes.find(
      (item) => item.method === "put" && item.path === "/meetings/config"
    );

    const response = await invokeMiddlewareChain(route);

    expect(response.statusCode).toBe(401);
    expect(response.value).toEqual({
      error: "Administrator role required",
      code: "ADMIN_REQUIRED",
    });
  });

  test("fixed routes register before numeric meeting routes", () => {
    const { routes } = setup();
    const fixed = routes.findIndex(
      (route) => route.path === "/meetings/config"
    );
    const numeric = routes.findIndex((route) => route.path === "/meetings/:id");
    expect(fixed).toBeGreaterThanOrEqual(0);
    expect(numeric).toBeGreaterThan(fixed);
    expect(
      routes.find(
        (route) => route.path === "/meetings/remote/:externalId/manifest"
      ).path
    ).toBe("/meetings/remote/:externalId/manifest");
  });

  test("import returns a durable job with a stable 202 envelope", async () => {
    const { routes, runtime } = setup();
    runtime.queueImport = jest.fn(async (input, userId) => ({
      id: 11,
      status: "CREATED",
      input,
      userId,
    }));
    const route = routes.find(
      (item) => item.method === "post" && item.path === "/meetings/import"
    );
    const response = await invoke(route, {
      body: { connectionId: 2, externalId: "remote-7", scope: { from: 0 } },
    });
    expect(response.statusCode).toBe(202);
    expect(response.value).toEqual({
      job: {
        id: 11,
        status: "CREATED",
        input: { connectionId: 2, externalId: "remote-7", scope: { from: 0 } },
        userId: 8,
      },
    });
  });

  test("conversation history exposes answers as an array and preserves scope metadata", async () => {
    const history = {
      conversation: {
        id: 4,
        meetingIds: [1],
        workspaceIds: [],
        scopeState: { available: false, blockedReason: "WAITING_CONTENT" },
      },
      answers: [{ id: 8, status: "ANSWERED", citations: [] }],
    };
    const { routes } = setup({ qa: { history: async () => history } });
    const route = routes.find(
      (item) =>
        item.method === "get" &&
        item.path === "/meetings/conversations/:id/answers"
    );

    const response = await invoke(route, { params: { id: "4" } });

    expect(response.value).toEqual({
      conversation: history.conversation,
      answers: history.answers,
    });
    expect(Array.isArray(response.value.answers)).toBe(true);
    expect(response.value.conversation.scopeState).toEqual(
      history.conversation.scopeState
    );
  });

  test("non-admin config response contains only connection status", async () => {
    const publicConfig = {
      id: 4,
      name: "Tencent",
      configured: true,
      appId: "private-app",
      operatorId: "private-operator",
      credentialHints: { secretKey: "••••abcd" },
      capabilities: { transcript: true },
      services: {
        ocr: { url: "https://private.example/parse", tokenPresent: true },
      },
    };
    const { routes, runtime } = setup(
      { config: { getPublic: async () => publicConfig } },
      { meeting_connections: { findMany: async () => [{ id: 4 }] } }
    );
    const response = await invoke(
      routes.find(
        (item) => item.method === "get" && item.path === "/meetings/config"
      )
    );
    expect(response.value.config).toEqual({
      id: 4,
      name: "Tencent",
      configured: true,
      capabilities: { transcript: true },
    });
    expect(JSON.stringify(response.value)).not.toMatch(
      /private|secret|tokenPresent/
    );
  });

  test("admin config response includes redacted nonsecret settings", async () => {
    const publicConfig = {
      id: 4,
      name: "Tencent",
      configured: true,
      appId: "app",
      credentialHints: { secretKey: "••••abcd" },
      capabilities: {},
    };
    const { routes } = setup(
      { config: { getPublic: async () => publicConfig } },
      { meeting_connections: { findMany: async () => [{ id: 4 }] } }
    );
    const response = await invoke(
      routes.find(
        (item) => item.method === "get" && item.path === "/meetings/config"
      ),
      { user: { id: 1, role: "admin" } }
    );
    expect(response.value.config).toEqual(publicConfig);
    expect(JSON.stringify(response.value)).not.toContain("actual-secret-value");
  });

  test("approved meeting deletion preserves the service error envelope", async () => {
    const { routes, runtime } = setup();
    runtime.meetings.softDelete = async () => {
      throw new MeetingError(
        "Only draft meetings can be deleted",
        "MEETING_IMMUTABLE",
        409
      );
    };
    const response = await invoke(
      routes.find(
        (item) => item.method === "delete" && item.path === "/meetings/:id"
      ),
      { params: { id: "9" } }
    );
    expect(response.statusCode).toBe(409);
    expect(response.value).toEqual({
      error: "Only draft meetings can be deleted",
      code: "MEETING_IMMUTABLE",
    });
  });

  test("original Tencent source has no delete route and uploads enforce the decimal limit", () => {
    const { routes } = setup();
    expect(MAX_UPLOAD_BYTES).toBe(100_000_000);
    expect(
      routes.some(
        (route) => route.method === "delete" && route.path.includes(":sourceId")
      )
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.method === "delete" &&
          route.path === "/meetings/:id/sources/:sourceId/original"
      )
    ).toBe(false);
  });

  test("multipart files over the limit return the agreed 413 envelope", async () => {
    const { routes, runtime } = setup();
    const response = await invoke(
      routes.find(
        (item) =>
          item.method === "post" && item.path === "/meetings/:id/sources/file"
      ),
      {
        params: { id: "1" },
        file: {
          size: 100_000_001,
          originalname: "too-large.pdf",
          path: "ignored",
        },
      }
    );
    expect(response.statusCode).toBe(413);
    expect(response.value).toEqual({
      error: "Each file must be 100 MB or smaller",
      code: "FILE_SIZE_LIMIT",
    });
    expect(runtime.upload).not.toHaveBeenCalled();
  });

  test("Workspace original download accepts only the retained originals root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-originals-"));
    const filePath = path.join(root, "retained.pdf");
    fs.writeFileSync(filePath, "retained original");
    try {
      const { routes } = setup(
        { lookupWorkspace: async () => ({ id: 3, slug: "workspace" }) },
        {
          workspace_documents: {
            findFirst: async () => ({
              docId: "doc-1",
              metadata: JSON.stringify({ workspaceOriginalId: "ref-1" }),
            }),
          },
        },
        {
          workspaceOriginalsRoot: root,
          originals: {
            resolve: async () => ({ filePath, fileName: "retained.pdf" }),
          },
        }
      );
      const response = new PassThrough();
      response.locals = {
        user: { id: 8, role: "default" },
        multiUserMode: true,
      };
      response.status = (code) => {
        response.statusCode = code;
        return response;
      };
      response.json = (value) => {
        response.value = value;
        return response;
      };
      response.setHeader = () => {};
      response.type = () => response;
      const pieces = [];
      response.on("data", (piece) => pieces.push(piece));
      const route = routes.find(
        (item) =>
          item.method === "get" &&
          item.path ===
            "/meetings/workspaces/:workspaceId/sources/:documentId/file"
      );
      await route.handler(
        {
          params: { workspaceId: "3", documentId: "doc-1" },
          query: {},
        },
        response
      );
      expect(Buffer.concat(pieces).toString()).toBe("retained original");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses the runtime's registered Workspace original resolver by default", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "meeting-runtime-originals-")
    );
    const filePath = path.join(root, "retained.pdf");
    fs.writeFileSync(filePath, "runtime-bound original");
    const originals = {
      resolve: jest.fn(async ({ referenceId, workspaceId, docId }) =>
        referenceId === "bound-ref" && workspaceId === 3 && docId === "doc-1"
          ? { filePath, fileName: "retained.pdf" }
          : null
      ),
    };
    try {
      const { routes } = setup(
        {
          lookupWorkspace: async () => ({ id: 3 }),
          getWorkspaceOriginals: () => originals,
        },
        {
          workspace_documents: {
            findFirst: async () => ({
              docId: "doc-1",
              metadata: JSON.stringify({ workspaceOriginalId: "bound-ref" }),
            }),
          },
        },
        { workspaceOriginalsRoot: root }
      );
      const response = new PassThrough();
      response.locals = {
        user: { id: 8, role: "default" },
        multiUserMode: true,
      };
      response.status = (code) => {
        response.statusCode = code;
        return response;
      };
      response.json = (value) => {
        response.value = value;
        return response;
      };
      response.setHeader = () => {};
      response.type = () => response;
      const pieces = [];
      response.on("data", (piece) => pieces.push(piece));
      const route = routes.find(
        (item) =>
          item.method === "get" &&
          item.path ===
            "/meetings/workspaces/:workspaceId/sources/:documentId/file"
      );
      await route.handler(
        { params: { workspaceId: "3", documentId: "doc-1" }, query: {} },
        response
      );
      expect(originals.resolve).toHaveBeenCalledWith({
        referenceId: "bound-ref",
        workspaceId: 3,
        docId: "doc-1",
      });
      expect(Buffer.concat(pieces).toString()).toBe("runtime-bound original");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
