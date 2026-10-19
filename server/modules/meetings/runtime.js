const crypto = require("crypto");
const path = require("path");
const { EventEmitter } = require("events");
const { createMeetingConfig } = require("./config");
const { createMeetingService } = require("./meetingService");
const { createSourceService } = require("./sources");
const { createMeetingAuthAccess } = require("../../utils/meetingGateway/meetingAuthAccess");
const { createImporter } = require("./importer");
const { createIndexer } = require("./indexer");
const { createJobRunner } = require("./jobs");
const { createQAService } = require("./qa");
const { createWorkspaceRetriever } = require("./retrieval");
const { createParser } = require("./parser");
const { createTencentClient } = require("./tencent");
const { MeetingError } = require("./errors");
const MAX_STREAM_EVENT_BYTES = 64 * 1024;
const MAX_STREAM_PARTIAL_BYTES = 64 * 1024;

function createWorkspaceSearchAdapter({
  prisma,
  vectorDb,
  embedder,
  originals,
  lookupDocument,
} = {}) {
  if (!prisma || !vectorDb || !embedder || typeof lookupDocument !== "function")
    throw new TypeError(
      "Workspace search requires provider, Prisma, embedder, and document lookup adapters"
    );
  return async ({ workspace, userId, question, limit = 10 }) => {
    let result;
    try {
      result = await vectorDb.performSimilaritySearch({
        namespace: workspace.slug,
        input: question,
        LLMConnector: {
          embedTextInput: (text) => embedder.embedTextInput(text),
        },
        topN: Math.max(1, Math.min(20, Number(limit) || 10)),
        similarityThreshold: 0.1,
      });
    } catch {
      throw new MeetingError(
        "Workspace retrieval failed",
        "WORKSPACE_RETRIEVAL_FAILED",
        502
      );
    }
    if (
      !result ||
      !Array.isArray(result.sources) ||
      result.success === false ||
      result.error
    )
      throw new MeetingError(
        "Workspace retrieval failed",
        "WORKSPACE_RETRIEVAL_FAILED",
        502
      );
    if (result.message && result.message !== false) {
      const documents = await prisma.workspace_documents.findMany({
        where: { workspaceId: Number(workspace.id) },
        select: { docId: true },
      });
      if (documents.length)
        throw new MeetingError(
          "Workspace retrieval failed",
          "WORKSPACE_RETRIEVAL_FAILED",
          502
        );
    }
    const evidence = [];
    for (const projected of result.sources) {
      const metadata = projected?.metadata || projected || {};
      const vectorId = String(metadata.vectorId || metadata.id || "");
      if (!vectorId) continue;
      const vectorRows = await prisma.document_vectors.findMany({
        where: { vectorId },
      });
      const documentId = vectorRows[0]?.docId;
      if (!documentId) continue;
      const document = await prisma.workspace_documents.findFirst({
        where: { workspaceId: Number(workspace.id), docId: String(documentId) },
      });
      if (!document) continue;
      const current = await lookupDocument({
        workspace,
        userId,
        documentId: String(documentId),
      });
      if (!current) continue;
      let documentMetadata;
      try {
        documentMetadata =
          typeof document.metadata === "string"
            ? JSON.parse(document.metadata || "{}")
            : document.metadata || {};
      } catch {
        documentMetadata = {};
      }
      const quote = String(projected?.text || metadata.text || "");
      if (!quote.trim()) continue;
      // Provider projections flatten chunk metadata. Keep only the locator
      // contract understood by the citation viewer; never expose arbitrary
      // provider metadata or infer a location from the filename.
      const location = workspaceLocation(metadata);
      const originalReference = documentMetadata.workspaceOriginalId;
      const original =
        originalReference && originals?.resolve
          ? await originals
              .resolve({
                referenceId: originalReference,
                workspaceId: Number(workspace.id),
                docId: String(documentId),
              })
              .catch(() => null)
          : null;
      evidence.push({
        evidenceId: `vector:${vectorId}`,
        documentId: String(documentId),
        revision: current.revision,
        name: document.filename,
        quote,
        location,
        score: Number.isFinite(Number(metadata.score))
          ? Number(metadata.score)
          : null,
        ...(original
          ? {
              link: `/api/meetings/workspaces/${workspace.id}/sources/${encodeURIComponent(documentId)}/file`,
              originalAvailable: true,
            }
          : { link: null, originalAvailable: false }),
      });
    }
    return evidence;
  };
}

function workspaceLocation(metadata = {}) {
  const raw =
    metadata.location && typeof metadata.location === "object"
      ? metadata.location
      : metadata;
  const type = String(
    raw.type || metadata.locationType || metadata.type || ""
  ).toLowerCase();
  const types = new Set([
    "paragraph",
    "page",
    "image",
    "cell",
    "slide",
    "transcript",
  ]);
  const allowed = [
    "paragraph",
    "page",
    "sheet",
    "cell",
    "slide",
    "startMs",
    "endMs",
  ];
  const values = {};
  for (const key of allowed) {
    const value = raw[key] ?? metadata[`location_${key}`];
    if (typeof value === "string" && value.length <= 200) values[key] = value;
    else if (Number.isSafeInteger(value) && value >= 0) values[key] = value;
  }
  if (!types.has(type)) return null;
  return { type, ...values };
}

function createBoundedSseSink({
  maxBufferedBytes = MAX_STREAM_EVENT_BYTES,
  maxPartialBytes = MAX_STREAM_PARTIAL_BYTES,
} = {}) {
  const sink = new EventEmitter();
  sink.writableEnded = false;
  sink.destroyed = false;
  const state = {
    completed: false,
    failed: false,
    failureCode: null,
    partialText: "",
    bufferedBytes: 0,
    peakBufferedBytes: 0,
  };
  let buffer = "";
  const markFailure = (code) => {
    state.failed = true;
    state.failureCode ||= code;
  };
  const appendPartial = (value) => {
    const remaining = maxPartialBytes - Buffer.byteLength(state.partialText);
    if (remaining <= 0) return;
    const chunk = Buffer.from(String(value)).subarray(0, remaining);
    let text = chunk.toString("utf8");
    if (text.endsWith("\uFFFD")) text = text.slice(0, -1);
    state.partialText += text;
  };
  const processFrame = (frame) => {
    if (Buffer.byteLength(frame) > maxBufferedBytes) {
      markFailure("STREAM_EVENT_TOO_LARGE");
      return;
    }
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let event;
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (typeof event.textResponse === "string")
        appendPartial(event.textResponse);
      if (event.type === "abort" || event.error)
        markFailure("STREAM_PROVIDER_ABORTED");
      if (
        event.type === "textResponseChunk" &&
        event.close === true &&
        !event.error
      )
        state.completed = true;
    }
  };
  sink.write = (wire) => {
    const pending = buffer + String(wire);
    buffer = "";
    let start = 0;
    let separator = pending.indexOf("\n\n", start);
    while (separator >= 0) {
      processFrame(pending.slice(start, separator));
      start = separator + 2;
      separator = pending.indexOf("\n\n", start);
    }
    buffer = pending.slice(start);
    state.bufferedBytes = Buffer.byteLength(buffer);
    state.peakBufferedBytes = Math.max(
      state.peakBufferedBytes,
      state.bufferedBytes
    );
    if (state.bufferedBytes > maxBufferedBytes) {
      buffer = "";
      state.bufferedBytes = 0;
      markFailure("STREAM_EVENT_TOO_LARGE");
    }
    return !state.failed;
  };
  return { sink, state };
}

function createMeetingRuntime({
  prisma = require("../../utils/prisma"),
  encryption = new (require("../../utils/EncryptionManager").EncryptionManager)(),
  getEmbedder = () =>
    require("../../utils/helpers").getEmbeddingEngineSelection(),
  getVectorDb = () => require("../../utils/helpers").getVectorDbClass(),
  resolveConnector = (args) =>
    require("../../utils/helpers").resolveProviderConnector(args),
  workspaceOriginals = null,
  storageRoot = path.join(
    process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"),
    "meetings"
  ),
  uploadRoot = path.join(
    process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"),
    "meeting-uploads"
  ),
  fetchImpl = globalThis.fetch,
  audit = null,
  runnerOptions = {},
  authService = null,
} = {}) {
  const { SystemSettings } = require("../../models/systemSettings");
  const auditWrite =
    audit ||
    (async (event, tx = prisma) => {
      await tx.event_logs.create({
        data: {
          event: event.action,
          userId: event.userId == null ? null : Number(event.userId),
          occurredAt: new Date(),
          metadata: JSON.stringify(
            Object.fromEntries(
              Object.entries(event).filter(
                ([key]) => !/secret|token|credential|content|text/i.test(key)
              )
            )
          ),
        },
      });
    });
  const config = createMeetingConfig({ prisma, encryption, audit: auditWrite });
  const getOriginals = () =>
    workspaceOriginals ||
    require("../../utils/workspaceOriginals").getWorkspaceOriginals();
  const lookupWorkspace = async ({ id, userId, db = prisma }) => {
    const workspace = await db.workspaces.findUnique({
      where: { id: Number(id) },
    });
    if (!workspace) return null;
    if (!(await SystemSettings.isMultiUserMode())) return workspace;
    const user =
      userId == null
        ? null
        : await db.users.findUnique({ where: { id: Number(userId) } });
    if (["admin", "manager"].includes(user?.role)) return workspace;
    const membership = await db.workspace_users.findFirst({
      where: { workspace_id: Number(id), user_id: Number(userId) },
    });
    return membership ? workspace : null;
  };
  const meetingAuthAccess = createMeetingAuthAccess({
    meetingStore: {
      findMeetings: (ids) => prisma.meetings.findMany({ where: { id: { in: ids } } }),
    },
    workspaceAccess: async ({ workspaceId, userId }) => Boolean(await lookupWorkspace({ id: workspaceId, userId })),
  });
  const meetings = createMeetingService({ prisma, audit: auditWrite, meetingAuthAccess });
  const jobAuthContext = (authState) => meetingAuthAccess.getJobAuthContext(authState);
  const reviseMeeting = meetings.revise.bind(meetings);
  meetings.revise = async (id, changes, userId, authState) => {
    meetingAuthAccess.assertRemoteAllowed({ authState, action: "meeting.revise" });
    return reviseMeeting(id, changes, userId, jobAuthContext(authState));
  };
  async function authorizeJob(job) {
    let payload;
    try { payload = JSON.parse(job.payload || "{}"); } catch { payload = {}; }
    const context = payload.authContext;
    if (!context || !["GATEWAY_SESSION", "LEGACY_MULTI_USER", "LEGACY_SINGLE_USER"].includes(context.kind))
      throw new MeetingError("Meeting job has no trusted initiator", "MGW_BUSINESS_AUTH_REQUIRED", 403);
    if (context.kind === "GATEWAY_SESSION") {
      if (!authService?.getValidatedSessionActor)
        throw new MeetingError("Meeting session registry is unavailable", "MGW_BUSINESS_AUTH_REQUIRED", 401);
      const trusted = await authService.getValidatedSessionActor({
        sessionId: context.sessionId,
        userId: context.userId,
        credentialEpoch: context.credentialEpoch,
      });
      meetingAuthAccess.assertRemoteAllowed({ authState: trusted, action: `job.${job.kind}` });
      const meeting = job.meetingId == null ? null : await prisma.meetings.findUnique({ where: { id: Number(job.meetingId) } });
      if (meeting && Number(meeting.createdBy) !== Number(trusted.actor.userId))
        throw new MeetingError("Meeting job is unavailable to this user", "MGW_RESOURCE_NOT_ACCESSIBLE", 403);
      return;
    }
    if (context.kind === "LEGACY_MULTI_USER" && (!Number.isSafeInteger(Number(context.userId)) || Number(context.userId) <= 0))
      throw new MeetingError("Meeting job has no trusted initiator", "MGW_BUSINESS_AUTH_REQUIRED", 403);
  }

  async function operation(connectionId = null) {
    const settings =
      connectionId == null ? null : await config.getPrivate(connectionId);
    const embedder = getEmbedder();
    const engine = process.env.EMBEDDING_ENGINE || "native";
    const model = String(embedder?.model || "default");
    const profileId = `${engine}:${model}`;
    const safeEmbed = async (method, input) => {
      try {
        return await embedder[method](input);
      } catch {
        throw new MeetingError(
          "Configured embedding service request failed",
          "EMBEDDING_FAILED",
          502
        );
      }
    };
    const indexer = createIndexer({
      prisma,
      profileId,
      embedder: {
        embedDocuments: (texts) => safeEmbed("embedChunks", texts),
        embedQuery: (text) => safeEmbed("embedTextInput", text),
      },
    });
    const parser = createParser({
      services: settings?.services || {},
      fetchImpl,
    });
    const sources = createSourceService({
      prisma,
      parser,
      indexer,
      storageRoot,
      trustedUploadRoot: uploadRoot,
      audit: auditWrite,
    });
    return {
      embedder,
      engine,
      model,
      profileId,
      indexer,
      parser,
      sources,
      settings,
    };
  }

  const makeClient = ({ config: privateConfig }) =>
    createTencentClient({ config: privateConfig, fetchImpl });
  const makeImporter = async (connectionId) => {
    const current = await operation(connectionId);
    const operationConfig = {
      getPrivate: async (id) =>
        Number(id) === Number(connectionId)
          ? current.settings
          : config.getPrivate(id),
    };
    return createImporter({
      prisma,
      meetingService: meetings,
      clientFactory: makeClient,
      sourceService: current.sources,
      configService: operationConfig,
      audit: auditWrite,
    });
  };
  const jobRunner = createJobRunner({
    prisma,
    ...runnerOptions,
    audit: auditWrite,
    authorizeJob,
    handlers: {
      IMPORT: async (job) =>
        (await makeImporter(job.connectionId)).process(job),
      PARSE_SOURCE: async (job) => {
        const meeting = await prisma.meetings.findUnique({
          where: { id: job.meetingId },
        });
        if (!meeting)
          throw new MeetingError("Meeting not found", "MEETING_NOT_FOUND", 404);
        return (await operation(meeting.connectionId)).sources.process(job);
      },
      REINDEX: async (job) => {
        const meeting = await prisma.meetings.findUnique({
          where: { id: job.meetingId },
        });
        if (!meeting)
          throw new MeetingError("Meeting not found", "MEETING_NOT_FOUND", 404);
        return (await operation(meeting.connectionId)).sources.process(job);
      },
    },
  });

  async function queueImport(input, userId, authState) {
    meetingAuthAccess.assertRemoteAllowed({ authState, action: "import" });
    const importer = await makeImporter(input.connectionId);
    return importer.queue(
      input.connectionId,
      input.externalId,
      input.scope || {},
      userId,
      jobAuthContext(authState)
    );
  }
  const remote = {
    async client(connectionId, authState) {
      meetingAuthAccess.assertRemoteAllowed({ authState, action: "remote.client" });
      const privateConfig = await config.getPrivate(connectionId);
      if (!privateConfig)
        throw new MeetingError(
          "Meeting connection not found",
          "MEETING_CONNECTION_NOT_FOUND",
          404
        );
      return makeClient({ config: privateConfig });
    },
    async list({ connectionId, authState, ...scope } = {}) {
      meetingAuthAccess.assertRemoteAllowed({ authState, action: "remote.list" });
      if (!connectionId)
        throw new MeetingError(
          "A connection ID is required",
          "INVALID_CONNECTION_ID"
        );
      const client = await this.client(connectionId, authState);
      return client.listMeetings({
        startTime: scope.startTime,
        endTime: scope.endTime,
        cursor: scope.cursor,
      });
    },
    async manifest(externalId, { connectionId, authState, ...scope } = {}) {
      meetingAuthAccess.assertRemoteAllowed({ authState, action: "remote.manifest" });
      if (!connectionId)
        throw new MeetingError(
          "A connection ID is required",
          "INVALID_CONNECTION_ID"
        );
      const client = await this.client(connectionId, authState);
      return client.describeMeeting(String(externalId), {
        startTime: scope.startTime,
        endTime: scope.endTime,
      });
    },
  };
  async function lookupDocument({ workspace, documentId, db = prisma }) {
    const row = await db.workspace_documents.findFirst({
      where: { workspaceId: Number(workspace.id), docId: String(documentId) },
    });
    if (!row) return null;
    const vectors = await db.document_vectors.findMany({
      where: { docId: String(documentId) },
    });
    const vectorIds = vectors.map((item) => String(item.vectorId)).sort();
    const metadata = row.metadata || "";
    const revision = crypto
      .createHash("sha256")
      .update(
        `${row.lastUpdatedAt?.toISOString?.() || row.lastUpdatedAt || ""}\n${metadata}\n${vectorIds.join("\n")}`
      )
      .digest("hex");
    return { ...row, revision };
  }
  async function workspaceRetriever(op) {
    const vectorDb = getVectorDb();
    const originals = getOriginals();
    return createWorkspaceRetriever({
      lookupWorkspace,
      lookupDocument,
      searchWorkspace: createWorkspaceSearchAdapter({
        prisma,
        vectorDb,
        embedder: op.embedder,
        originals,
        lookupDocument,
      }),
    });
  }
  async function makeQA(_userId) {
    const op = await operation();
    const retriever = await workspaceRetriever(op);
    const llm = {
      generate: async ({
        system,
        prompt,
        question,
        userId: requestedUserId,
      }) => {
        const syntheticWorkspace = {
          id: 0,
          slug: "meeting-intelligence",
          chatProvider: null,
          chatModel: null,
          openAiTemp: 0,
        };
        const user =
          requestedUserId == null
            ? null
            : await prisma.users.findUnique({
                where: { id: Number(requestedUserId) },
              });
        let connector;
        try {
          ({ connector } = await resolveConnector({
            workspace: syntheticWorkspace,
            prompt: question,
            user,
            thread: null,
            attachments: [],
            chatHistoryOverride: { rawHistory: [], chatHistory: [] },
            messageCountOverride: 0,
          }));
        } catch {
          throw new MeetingError(
            "Configured language model could not be selected",
            "MEETING_LLM_UNAVAILABLE",
            503
          );
        }
        if (!connector)
          throw new MeetingError(
            "Configured language model could not be selected",
            "MEETING_LLM_UNAVAILABLE",
            503
          );
        const messages = [
          { role: "system", content: String(system) },
          { role: "user", content: String(prompt) },
        ];
        try {
          if (
            connector.streamingEnabled?.() &&
            connector.streamGetChatCompletion &&
            connector.handleStream
          ) {
            const { sink, state } = createBoundedSseSink();
            let text;
            try {
              const stream = await connector.streamGetChatCompletion(messages, {
                user,
              });
              text = await connector.handleStream(sink, stream, {
                uuid: crypto.randomUUID(),
              });
            } catch {
              const error = new MeetingError(
                "Language model stream failed",
                "MEETING_LLM_FAILED",
                502
              );
              if (state.partialText) error.partialText = state.partialText;
              throw error;
            }
            if (state.failed || !state.completed) {
              const error = new MeetingError(
                "Language model stream did not complete",
                state.failed ? "MEETING_LLM_FAILED" : "MEETING_LLM_INCOMPLETE",
                502
              );
              const partial = state.partialText;
              if (partial) error.partialText = partial;
              throw error;
            }
            return text;
          }
          const result = await connector.getChatCompletion(messages, {
            user,
            temperature: 0,
          });
          return result?.textResponse;
        } catch (error) {
          if (error instanceof MeetingError) throw error;
          throw new MeetingError(
            "Configured language model request failed",
            "MEETING_LLM_FAILED",
            502
          );
        }
      },
    };
    return createQAService({
      prisma,
      indexer: op.indexer,
      workspaceRetriever: retriever,
      llm,
      meetingAuthAccess,
      audit: auditWrite,
    });
  }
  const qa = new Proxy(
    {},
    {
      get:
        (_target, property) =>
        async (...args) => {
          const authState = args[args.length - 1]?.kind ? args.pop() : null;
          meetingAuthAccess.getRequestState({ response: { locals: { meetingAuthState: authState } } });
          const userId = args[args.length - 1];
          const service = await makeQA(userId);
          return service[property](...args, authState);
        },
    }
  );
  const runtime = {
    prisma,
    config,
    meetings,
    jobs: jobRunner,
    remote,
    qa,
    lookupWorkspace,
    getWorkspaceOriginals: getOriginals,
    async listJobs(filters = {}, authState) {
      const where = {};
      if (filters.status) where.status = String(filters.status);
      if (filters.kind) where.kind = String(filters.kind);
      const rows = await prisma.meeting_jobs.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      if (authState?.kind !== "GATEWAY_SESSION") return rows;
      return rows.filter((job) => {
        try {
          const context = JSON.parse(job.payload || "{}").authContext;
          return context?.kind === "GATEWAY_SESSION" && Number(context.userId) === Number(authState.actor.userId);
        } catch { return false; }
      });
    },
    meetingFilters(filters = {}) {
      const where = {};
      if (filters.quarter) where.quarter = String(filters.quarter);
      if (filters.from || filters.to)
        where.startTime = {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lt: new Date(filters.to) } : {}),
        };
      return where;
    },
    async requestReindex(id, userId, authState) {
      meetingAuthAccess.assertRemoteAllowed({ authState, action: "reindex" });
      await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [id], action: "meeting.reindex" });
      const meeting = await meetings.get(id);
      const op = await operation(meeting.connectionId);
      return meetings.requestReindex(id, userId, op.profileId, jobAuthContext(authState));
    },
    async upload(meetingId, file, userId, authState) {
      meetingAuthAccess.assertRemoteAllowed({ authState, action: "source.parse" });
      await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [meetingId], action: "source.upload" });
      const meeting = await meetings.get(meetingId);
      return (await operation(meeting.connectionId)).sources.upload(
        meetingId,
        file,
        userId,
        jobAuthContext(authState)
      );
    },
    async queueImport(input, userId, authState) {
      return queueImport(input, userId, authState);
    },
    async retryJob(id, authState) {
      meetingAuthAccess.assertRemoteAllowed({ authState, action: "job.retry" });
      const job = await prisma.meeting_jobs.findUnique({ where: { id: Number(id) } });
      let context;
      try { context = JSON.parse(job?.payload || "{}").authContext; } catch {}
      const current = jobAuthContext(authState);
      if (!context || context.kind !== current.kind ||
          Number(context.userId) !== Number(current.userId) ||
          (current.kind === "GATEWAY_SESSION" && (context.sessionId !== current.sessionId || Number(context.credentialEpoch) !== Number(current.credentialEpoch))))
        throw new MeetingError("Meeting job is unavailable to this user", "MGW_RESOURCE_NOT_ACCESSIBLE", 403);
      return jobRunner.retry(id);
    },
    async start() {
      jobRunner.start();
    },
    async stop() {
      jobRunner.stop();
    },
  };
  Object.defineProperty(runtime, "sources", {
    get() {
      return {
        addText: async (id, data, userId, authState) => {
          meetingAuthAccess.assertRemoteAllowed({ authState, action: "source.parse" });
          await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [id], action: "source.add" });
          const m = await meetings.get(id);
          return (await operation(m.connectionId)).sources.addText(id, data, userId, jobAuthContext(authState));
        },
        remove: async (id, sourceId, userId, authState) => {
          meetingAuthAccess.assertRemoteAllowed({ authState, action: "source.reindex" });
          await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [id], action: "source.remove" });
          const m = await meetings.get(id);
          return (await operation(m.connectionId)).sources.remove(id, sourceId, userId, jobAuthContext(authState));
        },
        retry: async (meetingId, sourceId, userId, authState) => {
          meetingAuthAccess.assertRemoteAllowed({ authState, action: "source.retry" });
          await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [meetingId], action: "source.retry" });
          const source = await prisma.meeting_sources.findFirst({
            where: {
              id: Number(sourceId),
              meetingId: Number(meetingId),
              deletedAt: null,
            },
          });
          if (!source)
            throw new MeetingError(
              "Meeting source not found",
              "SOURCE_NOT_FOUND",
              404
            );
          const meeting = await meetings.get(meetingId);
          return (await operation(meeting.connectionId)).sources.retry(
            source.id,
            userId,
            jobAuthContext(authState)
          );
        },
        getSource: async (id, sourceId, authState) => {
          await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [id], action: "source.read" });
          const m = await meetings.get(id);
          return (await operation(m.connectionId)).sources.getSource(
            id,
            sourceId
          );
        },
        getArchivedSource: async (id, sourceId, authState) => {
          await meetingAuthAccess.assertLocalMeetingReadable({ authState, meetingIds: [id], action: "source.read" });
          const m = await prisma.meetings.findUnique({
            where: { id: Number(id) },
          });
          return (await operation(m?.connectionId)).sources.getArchivedSource(
            id,
            sourceId
          );
        },
      };
    },
  });
  return runtime;
}

module.exports = {
  createMeetingRuntime,
  createWorkspaceSearchAdapter,
  workspaceLocation,
  createBoundedSseSink,
};
