jest.mock("uuid", () => ({ v4: jest.fn(() => "test-document-id") }), { virtual: true });
jest.mock("../../utils/http", () => ({
  safeJsonParse: jest.fn((value, fallback) => {
    try { return JSON.parse(value); } catch { return fallback; }
  }),
}));
jest.mock("../../endpoints/utils", () => ({ getModelTag: jest.fn() }));
jest.mock("../../models/telemetry", () => ({ Telemetry: { sendTelemetry: jest.fn() } }));
jest.mock("../../models/eventLogs", () => ({ EventLogs: { logEvent: jest.fn() } }));
jest.mock("../../models/workspace", () => ({ Workspace: { where: jest.fn() } }));
jest.mock("../../utils/helpers", () => ({ getVectorDbClass: jest.fn() }));
jest.mock("../../utils/files", () => ({ purgeEntireVectorCache: jest.fn() }));

jest.mock("../../utils/prisma", () => ({
  workspace_documents: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  document_vectors: {
    findMany: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(async (operations) => Promise.all(operations)),
}));

const prisma = require("../../utils/prisma");
const { Document } = require("../../models/documents");
const { DocumentVectors } = require("../../models/vectors");

describe("generic document removal guards", () => {
  beforeEach(() => jest.clearAllMocks());

  test("direct generic add refuses a managed path before accessing the vector provider", async () => {
    const helpers = require("../../utils/helpers");
    await expect(Document.addDocuments(
      { id: 5, slug: "private-a" },
      ["meeting-managed/managed-doc.json"]
    )).rejects.toThrow("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP");
    expect(helpers.getVectorDbClass).not.toHaveBeenCalled();
  });
  test("lookup by vector docId returns persisted managed provenance for ownership checks", async () => {
    const managedProvenance = { operation_id: "operation-a", import_id: "import-a", generation: 1 };
    prisma.workspace_documents.findFirst.mockResolvedValue({
      docId: "managed-doc", workspaceId: 5, docpath: "meeting-managed/managed-doc.json",
      metadata: JSON.stringify({ managedProvenance }),
    });
    prisma.document_vectors.count.mockResolvedValue(2);
    await expect(Document.getManagedDocumentByDocId({ docId: "managed-doc" })).resolves.toMatchObject({
      docId: "managed-doc", workspaceId: 5, docpath: "meeting-managed/managed-doc.json",
      managedProvenance, vectorCount: 2,
    });
    expect(prisma.workspace_documents.findFirst).toHaveBeenCalledWith({ where: { docId: "managed-doc" } });
  });

  test("managed association persists provenance for future exact ownership checks", async () => {
    const managedProvenance = { operation_id: "operation-a", import_id: "import-a", generation: 1 };
    prisma.workspace_documents.findFirst.mockResolvedValue(null);
    prisma.workspace_documents.create.mockResolvedValue({});
    await expect(Document.addManagedDocument({
      workspace: { id: 5 }, location: "meeting-managed/managed-doc.json", docId: "managed-doc",
      document: { id: "managed-doc", pageContent: "notes", managedProvenance },
    })).resolves.toMatchObject({ associated: true, docId: "managed-doc" });
    expect(JSON.parse(prisma.workspace_documents.create.mock.calls[0][0].data.metadata).managedProvenance)
      .toEqual(managedProvenance);
  });

  test("managed association reuse rejects a different generation provenance", async () => {
    const requestedProvenance = {
      operation_id: "operation-new", import_id: "import-a", generation: 2,
      owner_user_id: 11, workspace_id: 5, payload_sha256: "d".repeat(64),
    };
    prisma.workspace_documents.findFirst.mockResolvedValue({
      docId: "managed-doc", workspaceId: 5, docpath: "meeting-managed/managed-doc.json",
      metadata: JSON.stringify({ managedProvenance: { ...requestedProvenance, operation_id: "operation-old" } }),
    });
    await expect(Document.addManagedDocument({
      workspace: { id: 5 }, location: "meeting-managed/managed-doc.json", docId: "managed-doc",
      document: { id: "managed-doc", pageContent: "notes", managedProvenance: requestedProvenance },
    })).rejects.toThrow("MGW_IMPORT_CONFLICT");
    expect(prisma.workspace_documents.create).not.toHaveBeenCalled();
  });
  test("workspace document bulk delete refuses matching managed locations", async () => {
    prisma.workspace_documents.findMany.mockResolvedValue([
      { docId: "managed-doc", docpath: "meeting-managed/managed-doc.json" },
    ]);
    await expect(Document.delete({ workspaceId: 5 })).rejects.toThrow("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP");
    expect(prisma.workspace_documents.deleteMany).not.toHaveBeenCalled();
  });

  test("ordinary workspace documents remain eligible for generic deletion", async () => {
    prisma.workspace_documents.findMany.mockResolvedValue([]);
    prisma.workspace_documents.deleteMany.mockResolvedValue({ count: 1 });
    await expect(Document.delete({ workspaceId: 6 })).resolves.toBe(true);
    expect(prisma.workspace_documents.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 6 } });
  });

  test("ordinary workspace paths remain eligible for generic removal", async () => {
    const workspace = { id: 6, slug: "ordinary" };
    Document.get = jest.fn().mockResolvedValue(null);
    await expect(Document.removeDocuments(workspace, ["custom-documents/ordinary.txt"])).resolves.toBe(true);
  });

  test("generic path removal refuses a managed location", async () => {
    const workspace = { id: 5, slug: "private-a" };
    await expect(Document.removeDocuments(workspace, ["meeting-managed/managed-doc.json"]))
      .rejects.toThrow("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP");
  });

  test("bulk vector deletion refuses rows belonging to managed documents", async () => {
    prisma.document_vectors.findMany.mockResolvedValue([{ docId: "managed-doc" }]);
    prisma.workspace_documents.findMany.mockResolvedValue([
      { docId: "managed-doc", docpath: "meeting-managed/managed-doc.json" },
    ]);
    await expect(DocumentVectors.delete({ docId: "managed-doc" }))
      .rejects.toThrow("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP");
    expect(prisma.document_vectors.deleteMany).not.toHaveBeenCalled();
  });

  test("vector reset checks for managed documents before any global cleanup", async () => {
    const { Workspace } = require("../../models/workspace");
    const { EventLogs } = require("../../models/eventLogs");
    const files = require("../../utils/files");
    const helpers = require("../../utils/helpers");
    const { resetAllVectorStores } = require("../../utils/vectorStore/resetAllVectorStores");
    const check = jest.spyOn(Document, "assertNoManagedDocuments").mockRejectedValue(new Error("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP"));
    const where = jest.spyOn(Workspace, "where").mockResolvedValue([{ id: 5, slug: "private-a" }]);
    const purge = jest.spyOn(files, "purgeEntireVectorCache").mockImplementation(() => {});
    const deleteVectors = jest.spyOn(DocumentVectors, "delete").mockResolvedValue(true);
    const log = jest.spyOn(EventLogs, "logEvent").mockResolvedValue(true);
    const vector = jest.spyOn(helpers, "getVectorDbClass");

    await expect(resetAllVectorStores({ vectorDbKey: "lancedb" })).resolves.toBe(false);
    expect(check).toHaveBeenCalledWith({});
    expect(purge).not.toHaveBeenCalled();
    expect(deleteVectors).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(vector).not.toHaveBeenCalled();
    where.mockRestore();
    check.mockRestore();
    purge.mockRestore();
    deleteVectors.mockRestore();
    log.mockRestore();
    vector.mockRestore();
  });
});
