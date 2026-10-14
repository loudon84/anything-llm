const { CollectorApi } = require("../../utils/collectorApi");

describe("Collector original retention hook", () => {
  test("retains before parser cleanup, attaches only generated references, and removes failed copies", async () => {
    const retained = {
      referenceId: "generated-reference",
      attach: async (documents) =>
        documents.map((document) => ({
          ...document,
          metadata: {
            ...document.metadata,
            originalFile: undefined,
            workspaceOriginalId: "generated-reference",
          },
        })),
      cleanup: jest.fn(async () => {}),
    };
    const collector = new CollectorApi();
    collector.endpoint = "http://collector.test";
    collector.comkey = { sign: () => "sig", encrypt: () => "enc" };
    collector.originalRetention = { retain: jest.fn(async () => retained) };
    collector.fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        documents: [{ metadata: { originalFile: "forged" } }],
      }),
    }));
    const result = await collector.processDocument("brief.pdf", {
      originalFile: "forged",
    });
    expect(collector.originalRetention.retain).toHaveBeenCalledWith(
      "brief.pdf"
    );
    expect(result.documents[0].metadata.workspaceOriginalId).toBe(
      "generated-reference"
    );
    expect(result.documents[0].metadata.originalFile).toBeUndefined();

    collector.fetchImpl.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });
    await collector.processDocument("broken.pdf");
    expect(retained.cleanup).toHaveBeenCalled();
  });
});
