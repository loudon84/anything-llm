const Module = require("module");
const path = require("path");

const databaseUrl = process.env.MEETING_TEST_DATABASE_URL;
if (!databaseUrl?.startsWith("file:"))
  throw new Error(
    "MEETING_TEST_DATABASE_URL must name an isolated SQLite file"
  );

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url
  );
  if (["127.0.0.1", "localhost", "::1"].includes(url.hostname))
    return originalFetch(input, options);
  throw new Error("External network is disabled in the meeting UI harness");
};

const realLoad = Module._load;
let prismaPatched = false;
let helpersPatched = false;
const serverRoot = path.resolve(__dirname, "../..");
const helpersPath = require.resolve(path.join(serverRoot, "utils/helpers"));

Module._load = function isolatedTask7Load(request, parent, isMain) {
  if (request === "dotenv") {
    const dotenv = realLoad.call(this, request, parent, isMain);
    dotenv.config = () => ({ parsed: {} });
    return dotenv;
  }

  const exports = realLoad.call(this, request, parent, isMain);
  if (request === "@prisma/client" && !prismaPatched) {
    const PrismaClient = exports.PrismaClient;
    exports.PrismaClient = class IsolatedPrismaClient extends PrismaClient {
      constructor(options = {}) {
        super({
          ...options,
          datasources: {
            ...options.datasources,
            db: { url: databaseUrl },
          },
        });
      }
    };
    prismaPatched = true;
  }

  let resolved = null;
  try {
    if (parent?.filename)
      resolved = require.resolve(
        path.resolve(path.dirname(parent.filename), request)
      );
  } catch {
    /* A package name or optional module is not the shared helper module. */
  }
  if (resolved === helpersPath && !helpersPatched) {
    exports.getEmbeddingEngineSelection = () => ({
      model: "task7-synthetic-embedder",
      embedChunks: async (texts) => texts.map(() => [1, 0]),
      embedTextInput: async () => [1, 0],
    });
    exports.getVectorDbClass = () => ({
      performSimilaritySearch: async () => ({ sources: [] }),
    });
    exports.resolveProviderConnector = async () => ({
      connector: {
        getChatCompletion: async (messages) => {
          const evidenceText = messages[1]?.content?.match(
            /Current evidence data: (\[[\s\S]*\])$/
          )?.[1];
          const evidence = JSON.parse(evidenceText || "[]");
          return {
            textResponse: JSON.stringify({
              status: evidence.length ? "ANSWERED" : "AWAITING_SOURCES",
              text: evidence[0]?.quote || "",
              missingInfo: evidence.length
                ? null
                : "No synthetic evidence found.",
              citations: evidence[0]
                ? [
                    {
                      evidenceId: evidence[0].evidenceId,
                      quote: evidence[0].quote,
                    },
                  ]
                : [],
            }),
          };
        },
      },
    });
    helpersPatched = true;
  }
  return exports;
};
