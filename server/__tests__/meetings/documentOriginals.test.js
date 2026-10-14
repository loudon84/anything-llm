const mockRows = [];
const mockVectorAdd = jest.fn(async () => ({ vectorized: true }));
const mockVectorDelete = jest.fn(async () => {});
const mockPrisma = {
  workspace_documents: {
    create: jest.fn(async ({ data }) => {
      const row = { id: mockRows.length + 1, ...data };
      mockRows.push(row);
      return row;
    }),
    findFirst: jest.fn(
      async ({ where }) =>
        mockRows.find(
          (row) =>
            row.workspaceId === where.workspaceId &&
            row.docpath === where.docpath
        ) || null
    ),
    delete: jest.fn(async ({ where }) => {
      const index = mockRows.findIndex(
        (row) => row.id === where.id && row.workspaceId === where.workspaceId
      );
      if (index >= 0) mockRows.splice(index, 1);
      return {};
    }),
  },
  document_vectors: { deleteMany: jest.fn(async () => ({ count: 1 })) },
};
const mockVectorDb = {
  addDocumentToNamespace: mockVectorAdd,
  deleteDocumentFromNamespace: mockVectorDelete,
};

jest.mock("../../utils/prisma", () => mockPrisma);
jest.mock("../../utils/helpers", () => ({
  getVectorDbClass: () => mockVectorDb,
}));
jest.mock("../../utils/EmbeddingWorkerManager", () => ({
  emitProgress: jest.fn(),
}));
jest.mock("../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn(async () => {}) },
}));
jest.mock("../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn(async () => {}) },
}));
jest.mock("../../endpoints/utils", () => ({ getModelTag: () => "test-model" }));

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CollectorApi } = require("../../utils/collectorApi");
const { Document } = require("../../models/documents");
const { createWorkspaceOriginals } = require("../../utils/workspaceOriginals");
const {
  documentsPath,
  fileData,
  moveProcessedDocsToFolder,
} = require("../../utils/files");

describe("persisted Collector originals through Workspace embedding", () => {
  let directory;
  let hotdir;
  let storage;
  let parsedFolder;
  let movedFolder;

  beforeEach(() => {
    mockRows.length = 0;
    jest.clearAllMocks();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "document-originals-"));
    hotdir = path.join(directory, "hotdir");
    storage = path.join(directory, "storage");
    parsedFolder = path.join(documentsPath, `task5a-${crypto.randomUUID()}`);
    movedFolder = null;
    fs.mkdirSync(hotdir, { recursive: true });
    fs.mkdirSync(parsedFolder, { recursive: true });
    fs.writeFileSync(path.join(hotdir, "source.pdf"), "original binary bytes");
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(parsedFolder, { recursive: true, force: true });
    if (movedFolder) fs.rmSync(movedFolder, { recursive: true, force: true });
  });

  async function parseThroughCollector() {
    const location = `${path.basename(parsedFolder)}/parsed.json`;
    const parsed = {
      id: crypto.randomUUID(),
      title: "Parsed document",
      pageContent: "Genuine parsed page content",
      metadata: { source: "collector" },
      location,
    };
    fs.writeFileSync(
      path.join(parsedFolder, "parsed.json"),
      JSON.stringify(parsed, null, 2)
    );
    const originals = createWorkspaceOriginals({
      hotdirPath: hotdir,
      storageRoot: storage,
    });
    const collector = new CollectorApi({
      originalRetention: originals,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ success: true, documents: [parsed] }),
      }),
    });
    collector.endpoint = "http://collector.test";
    collector.comkey = { sign: () => "sig", encrypt: () => "enc" };
    const result = await collector.processDocument("source.pdf");
    return { result, originals, location };
  }

  test("uses the flat saved JSON reference after Collector returns and the folder move completes", async () => {
    const { result, originals } = await parseThroughCollector();
    expect(result.success).toBe(true);
    const [document] = result.documents;
    const referenceId = document.workspaceOriginalId;
    expect(referenceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await fileData(document.location)).toMatchObject({
      id: document.id,
      workspaceOriginalId: referenceId,
      pageContent: document.pageContent,
    });

    const movedTo = `task5a-moved-${crypto.randomUUID()}`;
    movedFolder = path.join(documentsPath, movedTo);
    moveProcessedDocsToFolder(result.documents, movedTo);
    expect(await fileData(document.location)).toMatchObject({
      id: document.id,
      workspaceOriginalId: referenceId,
    });

    const workspaceOne = { id: 1, slug: "one" };
    const workspaceTwo = { id: 2, slug: "two" };
    const [first, second] = await Promise.all([
      Document.addDocuments(workspaceOne, [document.location], 7, {
        originalRetention: originals,
      }),
      Document.addDocuments(workspaceTwo, [document.location], 7, {
        originalRetention: originals,
      }),
    ]);
    expect(first).toMatchObject({
      failedToEmbed: [],
      embedded: [document.location],
    });
    expect(second).toMatchObject({
      failedToEmbed: [],
      embedded: [document.location],
    });
    expect(mockRows).toHaveLength(2);
    const rowOne = mockRows.find((row) => row.workspaceId === 1);
    const rowTwo = mockRows.find((row) => row.workspaceId === 2);
    expect(JSON.parse(rowOne.metadata).workspaceOriginalId).toBe(referenceId);
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: rowOne.docId })
    ).resolves.toMatchObject({ fileName: "source.pdf" });
    await expect(
      originals.resolve({ referenceId, workspaceId: 2, docId: rowTwo.docId })
    ).resolves.toMatchObject({ fileName: "source.pdf" });

    await Document.removeDocuments(workspaceOne, [document.location], null, {
      originalRetention: originals,
    });
    const removedDocId = rowOne.docId;
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: removedDocId })
    ).resolves.toBeNull();
    const readded = await Document.addDocuments(
      workspaceOne,
      [document.location],
      7,
      {
        originalRetention: originals,
      }
    );
    expect(readded.failedToEmbed).toEqual([]);
    const readdedRow = mockRows.find((row) => row.workspaceId === 1);
    await expect(
      originals.resolve({
        referenceId,
        workspaceId: 1,
        docId: readdedRow.docId,
      })
    ).resolves.toMatchObject({ fileName: "source.pdf" });
  });

  test("cleans vectors and reports failure when the parsed identity or document row cannot be committed", async () => {
    const { result, originals } = await parseThroughCollector();
    const [document] = result.documents;
    const referenceId = document.workspaceOriginalId;
    await require("../../utils/files").updateDocumentData(
      document.location,
      (data) => ({ ...data, id: "substituted-document" })
    );
    const forged = await Document.addDocuments(
      { id: 1, slug: "one" },
      [document.location],
      7,
      { originalRetention: originals }
    );
    expect(forged.failedToEmbed).toEqual(["Parsed document"]);
    expect(mockRows).toHaveLength(0);
    expect(mockVectorDelete).toHaveBeenCalledTimes(1);

    await require("../../utils/files").updateDocumentData(
      document.location,
      (data) => ({ ...data, id: document.id })
    );
    mockPrisma.workspace_documents.create.mockRejectedValueOnce(
      new Error("database write failed")
    );
    const failedRow = await Document.addDocuments(
      { id: 1, slug: "one" },
      [document.location],
      7,
      { originalRetention: originals }
    );
    expect(failedRow.failedToEmbed).toEqual(["Parsed document"]);
    expect(mockRows).toHaveLength(0);
    expect(mockVectorDelete).toHaveBeenCalledTimes(2);
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: "missing-row" })
    ).resolves.toBeNull();
  });
});
