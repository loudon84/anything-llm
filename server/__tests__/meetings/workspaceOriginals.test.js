const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWorkspaceOriginals } = require("../../utils/workspaceOriginals");

describe("retained Workspace originals", () => {
  let directory;
  let hotdir;
  let storage;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-originals-"));
    hotdir = path.join(directory, "hotdir");
    storage = path.join(directory, "storage");
    fs.mkdirSync(hotdir);
    fs.writeFileSync(path.join(hotdir, "brief.pdf"), "original bytes");
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test("binds generated originals to one parsed document and rejects forged or cross-document references", async () => {
    const originals = createWorkspaceOriginals({
      hotdirPath: hotdir,
      storageRoot: storage,
    });
    const retained = await originals.retain("brief.pdf");
    const [document] = await retained.attach([
      {
        pageContent: "parsed",
        metadata: {
          originalFile: "../../secret",
          workspaceOriginalId: "forged",
        },
      },
    ]);
    const referenceId = document.metadata.workspaceOriginalId;
    expect(referenceId).not.toBe("forged");
    await expect(
      originals.resolve({
        referenceId: "forged",
        workspaceId: 1,
        docId: "doc-1",
      })
    ).resolves.toBeNull();
    await expect(
      originals.resolve({ referenceId, workspaceId: 1, docId: "doc-1" })
    ).resolves.toBeNull();
    await originals.bind({ referenceId, workspaceId: 1, docId: "doc-1" });
    expect(
      await originals.resolve({ referenceId, workspaceId: 1, docId: "doc-1" })
    ).toMatchObject({
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
