const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { SystemSettings } = require("../models/systemSettings");
const { MeetingError } = require("../modules/meetings/errors");

const MAX_UPLOAD_BYTES = 100_000_000;
const SAFE_ID = /^\d+$/;

function numericId(value, label = "ID") {
  if (!SAFE_ID.test(String(value || "")))
    throw new MeetingError(
      `${label} must be a positive integer`,
      "INVALID_ID",
      400
    );
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MeetingError(
      `${label} must be a positive integer`,
      "INVALID_ID",
      400
    );
  return id;
}

function publicError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const candidateCode = String(error?.code || "MEETING_REQUEST_FAILED");
  const code = /^[A-Z0-9_]{2,80}$/i.test(candidateCode)
    ? candidateCode
    : "MEETING_REQUEST_FAILED";
  const safe = status < 500 && error instanceof MeetingError;
  return {
    status: status >= 400 && status <= 599 ? status : 500,
    body: {
      error: safe ? error.message : "Meeting request failed",
      code: safe ? code : status === 413 ? "FILE_SIZE_LIMIT" : code,
    },
  };
}

function withMiddlewareErrorEnvelope(middleware, code, fallbackMessage) {
  return function meetingMiddlewareWithErrorEnvelope(req, res, next) {
    const originalJson = res.json;
    const originalSendStatus = res.sendStatus;
    let continued = false;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      res.json = originalJson;
      if (originalSendStatus) res.sendStatus = originalSendStatus;
    };
    const deny = (status, body) => {
      restore();
      const message =
        typeof body?.error === "string" && body.error.length > 0
          ? body.error
          : fallbackMessage;
      res.status(status);
      return originalJson.call(res, { error: message, code });
    };

    res.json = function normalizedJson(body, ...args) {
      if (continued) return originalJson.call(this, body, ...args);
      return deny(res.statusCode || 401, body);
    };
    if (originalSendStatus) {
      res.sendStatus = function normalizedSendStatus(status) {
        if (continued) return originalSendStatus.call(this, status);
        return deny(status, null);
      };
    }

    const continueRequest = (error) => {
      continued = true;
      restore();
      return next(error);
    };
    try {
      return Promise.resolve(middleware(req, res, continueRequest)).catch(
        (error) => {
          restore();
          next(error);
        }
      );
    } catch (error) {
      restore();
      return next(error);
    }
  };
}

function createMeetingsEndpoints(
  router,
  {
    runtime,
    prisma,
    authenticate = validatedRequest,
    requireAdmin = flexUserRoleValid([ROLES.admin]),
    uploadRoot = path.resolve(
      process.env.STORAGE_DIR || path.join(__dirname, "../storage"),
      "meeting-uploads"
    ),
    meetingStorageRoot = path.resolve(
      process.env.STORAGE_DIR || path.join(__dirname, "../storage"),
      "meetings"
    ),
    workspaceOriginalsRoot = path.resolve(
      process.env.STORAGE_DIR || path.join(__dirname, "../storage"),
      "workspace-originals"
    ),
    originals = null,
    workspaceAccess = null,
  } = {}
) {
  if (!router || !runtime || !prisma)
    throw new TypeError(
      "createMeetingsEndpoints requires router, runtime, and prisma"
    );
  const workspaceOriginalResolver =
    originals || runtime.getWorkspaceOriginals?.() || null;
  fs.mkdirSync(uploadRoot, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadRoot),
      filename: (_req, file, cb) => {
        const ext = path
          .extname(String(file.originalname || ""))
          .toLowerCase()
          .replace(/[^.a-z0-9]/g, "")
          .slice(0, 12);
        cb(null, `${require("crypto").randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  }).single("file");
  const uploadMiddleware = (req, res, next) =>
    upload(req, res, (error) => {
      if (!error) return next();
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      const failure = tooLarge
        ? {
            status: 413,
            body: {
              error: "Each file must be 100 MB or smaller",
              code: "FILE_SIZE_LIMIT",
            },
          }
        : {
            status: 400,
            body: { error: "Invalid multipart upload", code: "INVALID_UPLOAD" },
          };
      if (req.file?.path)
        fs.promises.rm(req.file.path, { force: true }).catch(() => {});
      return res.status(failure.status).json(failure.body);
    });
  const auth = [
    withMiddlewareErrorEnvelope(
      authenticate,
      "AUTHENTICATION_REQUIRED",
      "Authentication required"
    ),
  ];
  const route = (method, suffix, roles, handler, middleware = []) =>
    router[method](
      "/meetings" + suffix,
      [...auth, ...(roles ? [roles] : []), ...middleware],
      async (req, res) => {
        let tempPath = req.file?.path;
        try {
          const user = await userFromSession(req, res);
          const result = await handler(req, res, user);
          if (result === STREAMED) return;
          if (result && result.status) res.status(result.status);
          res.json(result?.body ?? result ?? {});
        } catch (error) {
          const failure = publicError(error);
          res.status(failure.status).json(failure.body);
        } finally {
          if (tempPath)
            fs.promises.rm(tempPath, { force: true }).catch(() => {});
        }
      }
    );
  const STREAMED = Symbol("streamed response");
  const admin = withMiddlewareErrorEnvelope(
    requireAdmin,
    "ADMIN_REQUIRED",
    "Administrator role required"
  );
  const noRole = null;
  const reqBody = (req) =>
    req.body && typeof req.body === "object" ? req.body : {};
  const publicSource = (source) => {
    if (!source) return source;
    const { filePath: _filePath, contentText: _contentText, ...safe } = source;
    return safe;
  };
  const query = (req) => req.query || {};
  const isAdminUser = async (req, res, user) =>
    !(res.locals?.multiUserMode ?? (await SystemSettings.isMultiUserMode())) ||
    user?.role === ROLES.admin;
  const readFile = async (
    res,
    filePath,
    filename,
    inline = false,
    allowedRoot = meetingStorageRoot
  ) => {
    const absolute = path.resolve(filePath);
    const root = path.resolve(allowedRoot);
    const relative = path.relative(root, absolute);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new MeetingError(
        "Stored file is unavailable",
        "SOURCE_FILE_UNAVAILABLE",
        404
      );
    const stat = await fs.promises.stat(absolute);
    if (!stat.isFile())
      throw new MeetingError(
        "Stored file is unavailable",
        "SOURCE_FILE_UNAVAILABLE",
        404
      );
    const [realRoot, realFile] = await Promise.all([
      fs.promises.realpath(root),
      fs.promises.realpath(absolute),
    ]);
    const realRelative = path.relative(realRoot, realFile);
    if (
      realRelative === "" ||
      realRelative === ".." ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative) ||
      !(await fs.promises.stat(realFile)).isFile()
    )
      throw new MeetingError(
        "Stored file is unavailable",
        "SOURCE_FILE_UNAVAILABLE",
        404
      );
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename || "source")}`
    );
    res.type(path.extname(filename || "") || "application/octet-stream");
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(realFile);
      stream.on("error", reject);
      res.on("error", reject);
      res.on("finish", resolve);
      stream.pipe(res);
    });
  };

  // Fixed routes are deliberately registered before the numeric meeting routes.
  route("get", "/config", noRole, async (req, res, user) => {
    const adminView = await isAdminUser(req, res, user);
    const rows = await prisma.meeting_connections.findMany({
      orderBy: { id: "asc" },
    });
    const configs = await Promise.all(
      rows.map((row) => runtime.config.getPublic(row.id))
    );
    const config = adminView
      ? configs[0] || null
      : configs[0]
        ? {
            id: configs[0].id,
            name: configs[0].name,
            configured: configs[0].configured,
            capabilities: configs[0].capabilities || {},
          }
        : null;
    return { config };
  });
  route("put", "/config", admin, async (_req, _res, user) => ({
    config: await runtime.config.save(reqBody(_req), user?.id),
  }));
  route("get", "/remote", noRole, async (req) => ({
    meetings: await runtime.remote.list({
      connectionId: query(req).connectionId,
      startTime: query(req).startTime,
      endTime: query(req).endTime,
      cursor: query(req).cursor,
    }),
  }));
  route("get", "/remote/:externalId/manifest", noRole, async (req) => ({
    manifest: await runtime.remote.manifest(req.params.externalId, {
      connectionId: query(req).connectionId,
      startTime: query(req).startTime,
      endTime: query(req).endTime,
    }),
  }));
  route("post", "/import", noRole, async (req, _res, user) => ({
    status: 202,
    body: { job: await runtime.queueImport(reqBody(req), user?.id) },
  }));
  route("get", "/jobs", noRole, async (req) => ({
    jobs: await runtime.listJobs(query(req)),
  }));
  route("post", "/jobs/:id/retry", noRole, async (req) => ({
    job: await runtime.jobs.retry(numericId(req.params.id, "Job ID")),
  }));
  route("post", "/conversations", noRole, async (req, _res, user) => ({
    conversation: await runtime.qa.createConversation(reqBody(req), user?.id),
  }));
  route("get", "/conversations", noRole, async (_req, _res, user) => ({
    conversations: await runtime.qa.listConversations(user?.id),
  }));
  route("get", "/conversations/:id", noRole, async (req, _res, user) => ({
    conversation: await runtime.qa.getConversation(
      numericId(req.params.id, "Conversation ID"),
      user?.id
    ),
  }));
  route(
    "post",
    "/conversations/:id/questions",
    noRole,
    async (req, _res, user) => ({
      answer: await runtime.qa.ask(
        numericId(req.params.id, "Conversation ID"),
        reqBody(req),
        user?.id
      ),
    })
  );
  route(
    "get",
    "/conversations/:id/answers",
    noRole,
    async (req, _res, user) => {
      const history = await runtime.qa.history(
        numericId(req.params.id, "Conversation ID"),
        user?.id
      );
      return {
        conversation: history.conversation,
        answers: history.answers,
      };
    }
  );
  route(
    "get",
    "/workspaces/:workspaceId/sources/:documentId/file",
    noRole,
    async (req, res, user) => {
      const workspaceId = numericId(req.params.workspaceId, "Workspace ID");
      const workspace = await (workspaceAccess || runtime.lookupWorkspace)({
        id: workspaceId,
        userId: user?.id,
        user,
      });
      if (!workspace)
        throw new MeetingError(
          "Workspace is unavailable or inaccessible",
          "WORKSPACE_FORBIDDEN",
          403
        );
      const document = await prisma.workspace_documents.findFirst({
        where: { workspaceId, docId: String(req.params.documentId) },
      });
      if (!document)
        throw new MeetingError(
          "Workspace document is unavailable",
          "WORKSPACE_DOCUMENT_NOT_FOUND",
          404
        );
      const metadata =
        typeof document.metadata === "string"
          ? JSON.parse(document.metadata || "{}")
          : document.metadata || {};
      if (!metadata.workspaceOriginalId || !workspaceOriginalResolver)
        throw new MeetingError(
          "Original file is unavailable",
          "SOURCE_FILE_UNAVAILABLE",
          404
        );
      const original = await workspaceOriginalResolver.resolve({
        referenceId: metadata.workspaceOriginalId,
        workspaceId,
        docId: document.docId,
      });
      if (!original)
        throw new MeetingError(
          "Original file is unavailable",
          "SOURCE_FILE_UNAVAILABLE",
          404
        );
      await readFile(
        res,
        original.filePath,
        original.fileName,
        query(req).download !== "1",
        workspaceOriginalsRoot
      );
      return STREAMED;
    }
  );

  route("get", "", noRole, async (req) => ({
    meetings: await runtime.meetings.list(runtime.meetingFilters(query(req))),
  }));
  route("get", "/:id", noRole, async (req) => {
    const meeting = await runtime.meetings.get(
      numericId(req.params.id, "Meeting ID")
    );
    const sources = await prisma.meeting_sources.findMany({
      where: { meetingId: meeting.id, deletedAt: null },
      orderBy: { id: "asc" },
    });
    return { meeting, sources: sources.map(publicSource) };
  });
  route("patch", "/:id/content", noRole, async (req, _res, user) => ({
    meeting: await runtime.meetings.revise(
      numericId(req.params.id, "Meeting ID"),
      reqBody(req),
      user?.id
    ),
  }));
  route("post", "/:id/approve", noRole, async (req, _res, user) => ({
    meeting: await runtime.meetings.approve(
      numericId(req.params.id, "Meeting ID"),
      user?.id
    ),
  }));
  route("post", "/:id/reindex", noRole, async (req, _res, user) => ({
    status: 202,
    body: {
      job: await runtime.requestReindex(
        numericId(req.params.id, "Meeting ID"),
        user?.id
      ),
    },
  }));
  route("delete", "/:id", noRole, async (req, _res, user) => ({
    meeting: await runtime.meetings.softDelete(
      numericId(req.params.id, "Meeting ID"),
      user?.id
    ),
  }));
  route(
    "post",
    "/:id/sources/file",
    noRole,
    async (req, _res, user) => {
      if (!req.file)
        throw new MeetingError(
          "A file is required",
          "SOURCE_FILE_REQUIRED",
          400
        );
      if (req.file.size > MAX_UPLOAD_BYTES)
        throw new MeetingError(
          "Each file must be 100 MB or smaller",
          "FILE_SIZE_LIMIT",
          413
        );
      const source = await runtime.upload(
        numericId(req.params.id, "Meeting ID"),
        { name: req.file.originalname, tempPath: req.file.path },
        user?.id
      );
      return { status: 202, body: { source } };
    },
    [uploadMiddleware]
  );
  route("post", "/:id/sources/text", noRole, async (req, _res, user) => ({
    source: await runtime.sources.addText(
      numericId(req.params.id, "Meeting ID"),
      reqBody(req),
      user?.id
    ),
  }));
  route(
    "delete",
    "/:id/sources/:sourceId",
    noRole,
    async (req, _res, user) => ({
      source: await runtime.sources.remove(
        numericId(req.params.id, "Meeting ID"),
        numericId(req.params.sourceId, "Source ID"),
        user?.id
      ),
    })
  );
  route(
    "post",
    "/:id/sources/:sourceId/retry",
    noRole,
    async (req, _res, user) => ({
      job: await runtime.sources.retry(
        numericId(req.params.id, "Meeting ID"),
        numericId(req.params.sourceId, "Source ID"),
        user?.id
      ),
    })
  );
  route("get", "/:id/sources/:sourceId", noRole, async (req) => ({
    source: await runtime.sources.getSource(
      numericId(req.params.id, "Meeting ID"),
      numericId(req.params.sourceId, "Source ID")
    ),
  }));
  route("get", "/:id/sources/:sourceId/segments", noRole, async (req) => {
    const source = await runtime.sources.getArchivedSource(
      numericId(req.params.id, "Meeting ID"),
      numericId(req.params.sourceId, "Source ID")
    );
    let segments = source.segments;
    if (typeof segments === "string") {
      try {
        segments = JSON.parse(segments);
      } catch {
        segments = [];
      }
    }
    return { source: publicSource(source), segments: segments || [] };
  });
  route("get", "/:id/sources/:sourceId/file", noRole, async (req, res) => {
    const source = await runtime.sources.getArchivedSource(
      numericId(req.params.id, "Meeting ID"),
      numericId(req.params.sourceId, "Source ID")
    );
    if (!source?.filePath)
      throw new MeetingError(
        "Original file is unavailable",
        "SOURCE_FILE_UNAVAILABLE",
        404
      );
    await readFile(
      res,
      source.filePath,
      source.name,
      query(req).download !== "1"
    );
    return STREAMED;
  });
  return router;
}

function meetingsEndpoints(router, options) {
  return createMeetingsEndpoints(router, options);
}

module.exports = {
  meetingsEndpoints,
  createMeetingsEndpoints,
  MAX_UPLOAD_BYTES,
  numericId,
  publicError,
};
