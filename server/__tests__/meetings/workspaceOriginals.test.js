const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWorkspaceOriginals } = require("../../utils/workspaceOriginals");
const { documentsPath, fileData } = require("../../utils/files");
const contentHash = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");

describe("retained Workspace originals", () => {
  let directory;
  let hotdir;
  let storage;
  let parsedFolder;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-originals-"));
    hotdir = path.join(directory, "hotdir");
    storage = path.join(directory, "storage");
    fs.mkdirSync(hotdir);
    fs.writeFileSync(path.join(hotdir, "brief.pdf"), "original bytes");
    parsedFolder = path.join(documentsPath, `task5a-${crypto.randomUUID()}`);
    fs.mkdirSync(parsedFolder, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(parsedFolder, { recursive: true, force: true });
  });

  test("persists a generated reference into the flat parsed document and binds only its genuine identity", async () => {
    const originals = createWorkspaceOriginals({
      hotdirPath: hotdir,
      storageRoot: storage,
    });
    const parsedPath = path.join(parsedFolder, "parsed.json");
    const location = `${path.basename(parsedFolder)}/parsed.json`;
    fs.writeFileSync(
      parsedPath,
      JSON.stringify({
        id: "genuine-parsed-A",
        title: "A",
        pageContent: "parsed content A",
        metadata: {
          originalFile: "../../secret",
          workspaceOriginalId: "forged",
        },
      })
    );
    const retained = await originals.retain("brief.pdf");
    const [document] = await retained.attach([
      {
        id: "genuine-parsed-A",
        location,
        pageContent: "parsed content A",
        metadata: {
          originalFile: "../../secret",
          workspaceOriginalId: "forged",
        },
      },
    ]);
    const referenceId = document.workspaceOriginalId;
    expect(referenceId).not.toBe("forged");
    await expect(fileData(location)).resolves.toMatchObject({
      id: "genuine-parsed-A",
      workspaceOriginalId: referenceId,
      pageContent: "parsed content A",
    });
    expect(document.metadata.workspaceOriginalId).toBeUndefined();
    await expect(
      originals.resolve({
        referenceId: "forged",
        workspaceId: 1,
        docId: "doc-1",
      })
    ).resolves.toBeNull();
    await expect(
      originals.bind({
        referenceId,
        workspaceId: 1,
        docId: "doc-1",
        parsedDocumentId: "unrelated-document-B",
        documentPath: location,
        contentHash: "wrong-hash",
      })
    ).rejects.toThrow();
    await originals.bind({
      referenceId,
      workspaceId: 1,
      docId: "doc-1",
      parsedDocumentId: "genuine-parsed-A",
      documentPath: location,
      contentHash: contentHash("parsed content A"),
    });
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: "doc-1" })
    ).resolves.toMatchObject({
      filePath: path.join(
        storage,
        "workspace-originals",
        `${retained.referenceId}.pdf`
      ),
    });
    await expect(
      originals.resolve({ referenceId, workspaceId: 2, docId: "doc-1" })
    ).resolves.toBeNull();
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: "other-doc" })
    ).resolves.toBeNull();
  });

  test("keeps the parsed reference reusable for concurrent workspace bindings and remove-readd", async () => {
    const originals = createWorkspaceOriginals({
      hotdirPath: hotdir,
      storageRoot: storage,
    });
    const parsedPath = path.join(parsedFolder, "parsed.json");
    const location = `${path.basename(parsedFolder)}/parsed.json`;
    fs.writeFileSync(
      parsedPath,
      JSON.stringify({ id: "parsed-id", pageContent: "same parsed bytes" })
    );
    const retained = await originals.retain("brief.pdf");
    const [document] = await retained.attach([
      { id: "parsed-id", location, pageContent: "same parsed bytes" },
    ]);
    const referenceId = document.workspaceOriginalId;
    const binding = (workspaceId, docId) =>
      originals.bind({
        referenceId,
        workspaceId,
        docId,
        parsedDocumentId: "parsed-id",
        documentPath: location,
        contentHash: contentHash("same parsed bytes"),
      });
    await Promise.all([binding(1, "doc-a"), binding(2, "doc-b")]);
    await binding(1, "doc-a");
    await originals.unbind({ referenceId, workspaceId: 1, docId: "doc-a" });
    await binding(1, "doc-a-readded");
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: "doc-a" })
    ).resolves.toBeNull();
    await expect(
      originals.resolve({ referenceId, workspaceId: 2, docId: "doc-b" })
    ).resolves.toMatchObject({ referenceId });
    await expect(
      originals.resolve({
        referenceId,
        workspaceId: 1,
        docId: "doc-a-readded",
      })
    ).resolves.toMatchObject({ referenceId });
  });

  test("removes the retained copy when processing fails", async () => {
    const originals = createWorkspaceOriginals({
      hotdirPath: hotdir,
      storageRoot: storage,
    });
    const retained = await originals.retain("brief.pdf");
    await retained.cleanup();
    expect(
      fs.existsSync(
        path.join(storage, "workspace-originals", `${retained.referenceId}.pdf`)
      )
    ).toBe(false);
  });
});
