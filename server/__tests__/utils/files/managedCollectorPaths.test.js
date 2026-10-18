process.env.STORAGE_DIR = __dirname;

jest.mock("uuid", () => ({ v4: jest.fn(() => "uuid"), v5: jest.fn(() => "uuid") }), { virtual: true });
jest.mock("../../../models/documents", () => ({ Document: {} }));
jest.mock("../../../models/documentSyncQueue", () => ({ DocumentSyncQueue: { enabled: jest.fn().mockResolvedValue(false) } }));
const fs = require("fs");
const path = require("path");
const {
  findDocumentInDocuments,
  fileToPickerData,
  getDocumentsByDocPaths,
  documentsPath,
} = require("../../../utils/files");

describe("managed Collector documents stay outside public file lookup", () => {
  test("A-REV-004-02 filename lookup does not search the meeting-managed directory", async () => {
    const folder = path.join(documentsPath, "meeting-managed");
    const filename = `managed-${Date.now()}.json`;
    const fullPath = path.join(folder, filename);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify({ title: "private", managedProvenance: { operation_id: "op" } }));
    try {
      await expect(findDocumentInDocuments(filename)).resolves.toBeNull();
    } finally {
      fs.rmSync(fullPath, { force: true });
    }
  });

  test("A-REV-004-02 explicit workspace docpaths skip the managed namespace before stat", async () => {
    const managedPath = path.resolve(documentsPath, "meeting-managed", "secret.json");
    const stat = jest.spyOn(fs, "statSync");
    try {
      await expect(getDocumentsByDocPaths(["meeting-managed/secret.json"])).resolves.toEqual([]);
      expect(stat).not.toHaveBeenCalledWith(managedPath, expect.anything());
    } finally {
      stat.mockRestore();
    }
  });

  test.each(["small", "streamed"]) (
    "A-REV-004-02 %s managed picker paths are rejected before stat or read",
    async (sizeBranch) => {
      const managedPath = path.join(documentsPath, "meeting-managed", `${sizeBranch}.json`);
      const stat = jest.spyOn(fs, "statSync");
      const read = jest.spyOn(fs, "readFileSync");
      const stream = jest.spyOn(fs, "createReadStream");
      try {
        await expect(fileToPickerData({ pathToFile: managedPath, cachefilename: `meeting-managed/${sizeBranch}.json` })).resolves.toBeNull();
        expect(stat).not.toHaveBeenCalledWith(managedPath, expect.anything());
        expect(read).not.toHaveBeenCalledWith(managedPath, expect.anything());
        expect(stream).not.toHaveBeenCalledWith(managedPath, expect.anything());
      } finally {
        stat.mockRestore();
        read.mockRestore();
        stream.mockRestore();
      }
    }
  );
});
