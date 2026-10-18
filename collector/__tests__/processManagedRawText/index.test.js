const fs = require("fs");
const os = require("os");
const path = require("path");
jest.mock("slugify", () => ({ default: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-") }), { virtual: true });
jest.mock("uuid", () => ({ v4: jest.fn(() => `${Date.now()}-${Math.random()}`) }), { virtual: true });
jest.mock("../../utils/tokenizer", () => ({ tokenizeString: jest.fn(() => 3) }));
jest.mock("../../utils/files", () => ({ writeToServerDocuments: jest.fn(({ data }) => ({ location: `custom-documents/raw-${data.id}.json` })) }));
const { writeToServerDocuments } = require("../../utils/files");
const { createManagedStore } = require("../../utils/managedDocumentStore");
const { processManagedRawText, buildPayloadHash } = require("../../processManagedRawText");

function input(overrides = {}) {
  const value = {
    operation_id: "operation-a",
    import_id: "import-a",
    generation: 1,
    owner_user_id: 11,
    workspace_id: "workspace-a",
    textContent: "same meeting body",
    metadata: { title: "Meeting transcript", docSource: "Tencent Meeting" },
    ...overrides,
  };
  value.payload_sha256 = buildPayloadHash(value);
  return value;
}
let root;
let store;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mgw-managed-"));
  store = createManagedStore({ root, documentsRoot: path.join(root, "documents") });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("PLAN-MGW-008 managed raw text", () => {
  test("A-IMPORT-001-01 same operation and payload concurrently commit one stable file", async () => {
    const [first, second] = await Promise.all([
      processManagedRawText(input(), { store, clock: () => new Date("2026-01-01T00:00:00Z") }),
      processManagedRawText(input(), { store, clock: () => new Date("2026-01-01T00:00:00Z") }),
    ]);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.documents[0].location).toBe(second.documents[0].location);
    expect(fs.readdirSync(path.join(root, "documents", "meeting-managed")).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(first.operationState).toBe("COMMITTED");
  });

  test("A-RETRY-001-01 the same operation id cannot claim a different payload", async () => {
    await processManagedRawText(input(), { store });
    await expect(processManagedRawText(input({ textContent: "different body" }), { store })).rejects.toThrow("MGW_IMPORT_CONFLICT");
  });

  test("A-REV-004-01 same body from two owners has distinct files and private provenance", async () => {
    const first = await processManagedRawText(input(), { store });
    const second = await processManagedRawText(input({ operation_id: "operation-b", import_id: "import-b", owner_user_id: 22, workspace_id: "workspace-b" }), { store });
    expect(first.documents[0].location).not.toBe(second.documents[0].location);
    const firstDoc = JSON.parse(fs.readFileSync(path.join(root, "documents", first.documents[0].location), "utf8"));
    const secondDoc = JSON.parse(fs.readFileSync(path.join(root, "documents", second.documents[0].location), "utf8"));
    expect(firstDoc.managedProvenance.owner_user_id).toBe(11);
    expect(secondDoc.managedProvenance.owner_user_id).toBe(22);
    expect(firstDoc.pageContent).toBe(secondDoc.pageContent);
  });

  test("A-RETRY-001-02 PREPARED journal recovers the same preallocated UUID after a write-stage failure", async () => {
    const failingStore = createManagedStore({ root, documentsRoot: path.join(root, "documents"), afterDocumentWrite: async () => { throw new Error("simulated process loss before commit"); } });
    await expect(processManagedRawText(input(), { store: failingStore })).rejects.toThrow("simulated process loss");
    const prepared = await store.get("operation-a");
    expect(prepared.state).toBe("PREPARED");
    const recovered = await processManagedRawText(input(), { store });
    expect(recovered.documents[0].location).toBe(prepared.location);
    expect(recovered.operationState).toBe("COMMITTED");
  });

  test("A-IMPORT-001-02 ordinary raw text remains non-idempotent and uses its original folder", async () => {
    const { processRawText } = require("../../processRawText");
    const result = await processRawText("ordinary text", { title: "Ordinary.txt" });
    const retry = await processRawText("ordinary text", { title: "Ordinary.txt" });
    expect(result.success).toBe(true);
    expect(result.documents[0].location).toContain("custom-documents/raw-")
    expect(retry.documents[0].location).not.toBe(result.documents[0].location);
  });
});
