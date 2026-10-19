process.env.NODE_ENV === "development"
  ? require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` })
  : require("dotenv").config();

require("./utils/logger")();
require("./utils/boot/patchSdkTimeouts")();
require("./utils/helpers/modelPricing"); // boots the model pricing cache refresh
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const { reqBody } = require("./utils/http");
const { systemEndpoints } = require("./endpoints/system");
const { workspaceEndpoints } = require("./endpoints/workspaces");
const { chatEndpoints } = require("./endpoints/chat");
const { embeddedEndpoints } = require("./endpoints/embed");
const { embedManagementEndpoints } = require("./endpoints/embedManagement");
const { getVectorDbClass } = require("./utils/helpers");
const { adminEndpoints } = require("./endpoints/admin");
const { modelRouterEndpoints } = require("./endpoints/modelRouter");
const { inviteEndpoints } = require("./endpoints/invite");
const { utilEndpoints } = require("./endpoints/utils");
const { developerEndpoints } = require("./endpoints/api");
const { extensionEndpoints } = require("./endpoints/extensions");
const { bootHTTP, bootSSL } = require("./utils/boot");
const { workspaceThreadEndpoints } = require("./endpoints/workspaceThreads");
const { documentEndpoints } = require("./endpoints/document");
const { agentWebsocket } = require("./endpoints/agentWebsocket");
const {
  agentSkillWhitelistEndpoints,
} = require("./endpoints/agentSkillWhitelist");
const { agentFileServerEndpoints } = require("./endpoints/agentFileServer");
const { experimentalEndpoints } = require("./endpoints/experimental");
const { browserExtensionEndpoints } = require("./endpoints/browserExtension");
const { communityHubEndpoints } = require("./endpoints/communityHub");
const { agentFlowEndpoints } = require("./endpoints/agentFlows");
const { mcpServersEndpoints } = require("./endpoints/mcpServers");
const { mobileEndpoints } = require("./endpoints/mobile");
const { webPushEndpoints } = require("./endpoints/webPush");
const { telegramEndpoints } = require("./endpoints/telegram");
const { scheduledJobEndpoints } = require("./endpoints/scheduledJobs");
const {
  outlookAgentEndpoints,
} = require("./endpoints/utils/outlookAgentUtils");
const {
  googleAgentSkillEndpoints,
} = require("./endpoints/utils/googleAgentSkillEndpoints");
const { memoryEndpoints } = require("./endpoints/memory");
const { meetingsEndpoints } = require("./endpoints/meetings");
const { createMeetingRuntime } = require("./modules/meetings/runtime");
const { attachMeetingRuntime } = require("./modules/meetings/serverLifecycle");
const { httpLogger } = require("./middleware/httpLogger");
const { meetingGatewayEndpoints } = require("./endpoints/meetingGateway");
const { createWeComAuthEndpoints } = require("./endpoints/wecomAuth");
const { createSessionModule } = require("./utils/meetingGateway/sessions");
const { createGatewayClient } = require("./utils/meetingGateway/client");
const { createEmployeeAuthService } = require("./utils/meetingGateway/employeeAuth");
const {
  createWeComGatewayClient,
} = require("./utils/meetingGateway/wecomClient");
const {
  createWeComAuthRuntime,
} = require("./utils/meetingGateway/wecomAuthRuntime");
const { createMeetingStore } = require("./models/meetingGateway");
const { createWeComIdentityStore } = require("./models/wecomIdentity");
const meetingGatewayOrigin = process.env.MEETING_GATEWAY_ORIGIN || "";
const meetingGatewayScopes = (process.env.MEETING_GATEWAY_SCOPES || "meeting.read meeting.query").split(/\s+/).filter(Boolean);
const meetingGatewayAuthReady = Boolean(
  process.env.MEETING_GATEWAY_ENABLED === "true" && meetingGatewayOrigin &&
  process.env.MEETING_GATEWAY_INSTANCE_ID && process.env.MEETING_GATEWAY_CLIENT_ID &&
  process.env.MEETING_GATEWAY_CLIENT_SECRET && process.env.MEETING_GATEWAY_REST_RESOURCE
);
let meetingGatewayAuthClient = null;
if (meetingGatewayAuthReady) {
  try { meetingGatewayAuthClient = createGatewayClient({
  origin: meetingGatewayOrigin, originAllowlist: [meetingGatewayOrigin],
  allowlist: ["/api/v1/auth/account-login", "/api/v1/auth/exchange", "/api/v1/oauth/authorizations", "/api/v1/me/connections"],
  gatewayInstanceId: process.env.MEETING_GATEWAY_INSTANCE_ID, clientId: process.env.MEETING_GATEWAY_CLIENT_ID,
  clientSecret: process.env.MEETING_GATEWAY_CLIENT_SECRET, scopes: meetingGatewayScopes,
  resource: process.env.MEETING_GATEWAY_REST_RESOURCE, enabled: true,
  contractEvidence: { confirmed: /^[a-f0-9]{64}$/i.test(process.env.MEETING_GATEWAY_CONTRACT_SHA256 || "") && Boolean(process.env.MEETING_GATEWAY_CONTRACT_REVISION) },
}); } catch (_error) { meetingGatewayAuthClient = null; }
}
const { SystemSettings } = require("./models/systemSettings");
const { User } = require("./models/user");
const prisma = require("./utils/prisma");
function parseMeetingKeyring() {
  try {
    const hmacHex = process.env.MEETING_GATEWAY_BRIDGE_HMAC_KEY || "";
    const keyring = JSON.parse(
      process.env.MEETING_GATEWAY_BRIDGE_KEYRING_JSON || "{}"
    );
    if (
      !/^[a-f0-9]{64}$/i.test(hmacHex) ||
      !keyring.activeKeyId ||
      !keyring.keys ||
      typeof keyring.keys !== "object"
    )
      return null;
    const keys = {};
    for (const [keyId, value] of Object.entries(keyring.keys)) {
      if (!/^[a-f0-9]{64}$/i.test(value)) return null;
      keys[keyId] = Buffer.from(value, "hex");
    }
    return {
      activeKeyId: keyring.activeKeyId,
      keys,
      hmacKey: Buffer.from(hmacHex, "hex"),
    };
  } catch {
    return null;
  }
}
const meetingKeyring = parseMeetingKeyring();
const meetingSessions = meetingKeyring
  ? createSessionModule({
      store: createMeetingStore({ prisma }),
      gateway: meetingGatewayAuthClient,
      keyring: meetingKeyring,
      origin: process.env.MEETING_GATEWAY_ALLOWED_ORIGIN,
    })
  : null;
// No live WeCom wire contract is signed off. Keep the client unavailable while
// allowing the BFF to expose an explicit dependency status without startup failure.
const meetingWecomGateway = createWeComGatewayClient({
  contract: null,
  transport: null,
});
const meetingWecomAuth = createWeComAuthRuntime({
  gateway: meetingWecomGateway,
  store: createWeComIdentityStore({ prisma }),
  jwtSecret: process.env.JWT_SECRET,
  getUser: (id) => User.get({ id }),
  isPasswordlessSingleUser: async () =>
    !process.env.AUTH_TOKEN && !(await SystemSettings.isMultiUserMode()),
  origin: process.env.MEETING_GATEWAY_ALLOWED_ORIGIN || null,
  callbackUri: process.env.MEETING_GATEWAY_ALLOWED_ORIGIN
    ? process.env.MEETING_GATEWAY_ALLOWED_ORIGIN + "/api/auth/wecom/callback"
    : null,
  resultUri: process.env.MEETING_GATEWAY_ALLOWED_ORIGIN
    ? process.env.MEETING_GATEWAY_ALLOWED_ORIGIN + "/sso/wecom/result"
    : null,
  cryptoConfig: meetingKeyring,
});
const meetingGatewayIdentityStore = createWeComIdentityStore({ prisma });
const meetingEmployeeAuth = meetingGatewayAuthClient && meetingSessions && process.env.JWT_SECRET ? createEmployeeAuthService({
  gateway: meetingGatewayAuthClient, identityStore: meetingGatewayIdentityStore, sessions: meetingSessions,
  jwt: { sign: (claims, expiresIn) => require("jsonwebtoken").sign(claims, process.env.JWT_SECRET, { expiresIn }) },
  origin: process.env.MEETING_GATEWAY_ALLOWED_ORIGIN || null,
  isMultiUserMode: () => SystemSettings.isMultiUserMode(),
}) : null;
const app = express();
app.locals.meetingWecomAuth = meetingWecomAuth;
const apiRouter = express.Router();
const meetingRuntime = createMeetingRuntime({ authService: meetingWecomAuth });
const meetingGatewayContractConfirmed =
  /^[a-f0-9]{64}$/i.test(process.env.MEETING_GATEWAY_CONTRACT_SHA256 || "") &&
  Boolean(process.env.MEETING_GATEWAY_CONTRACT_REVISION);
app.locals.meetingGateway = Object.freeze({
  enabled:
    process.env.MEETING_GATEWAY_ENABLED === "true" &&
    meetingGatewayContractConfirmed,
  contractConfirmed: meetingGatewayContractConfirmed,
  oauth: null,
});
const FILE_LIMIT = "3GB";

// Only log HTTP requests in development mode and if the ENABLE_HTTP_LOGGER environment variable is set to true
if (
  process.env.NODE_ENV === "development" &&
  !!process.env.ENABLE_HTTP_LOGGER
) {
  app.use(
    httpLogger({
      enableTimestamps: !!process.env.ENABLE_HTTP_LOGGER_TIMESTAMPS,
    })
  );
}
app.use(cors({ origin: true }));
app.use(bodyParser.text({ limit: FILE_LIMIT }));
app.use(bodyParser.json({ limit: FILE_LIMIT }));
app.use(
  bodyParser.urlencoded({
    limit: FILE_LIMIT,
    extended: true,
  })
);

let bootedServer = null;
if (!!process.env.ENABLE_HTTPS) {
  bootedServer = bootSSL(app, process.env.SERVER_PORT || 3001).server;
} else {
  require("@mintplex-labs/express-ws").default(app); // load WebSockets in non-SSL mode.
}

app.use("/api", apiRouter);
systemEndpoints(apiRouter);
extensionEndpoints(apiRouter);
workspaceEndpoints(apiRouter);
workspaceThreadEndpoints(apiRouter);
chatEndpoints(apiRouter);
adminEndpoints(apiRouter);
modelRouterEndpoints(apiRouter);
inviteEndpoints(apiRouter);
embedManagementEndpoints(apiRouter);
utilEndpoints(apiRouter);
documentEndpoints(apiRouter);
agentWebsocket(apiRouter);
agentSkillWhitelistEndpoints(apiRouter);
agentFileServerEndpoints(apiRouter);
experimentalEndpoints(apiRouter);
developerEndpoints(app, apiRouter);
communityHubEndpoints(apiRouter);
agentFlowEndpoints(apiRouter);
mcpServersEndpoints(apiRouter);
mobileEndpoints(apiRouter);
webPushEndpoints(apiRouter);
telegramEndpoints(apiRouter);
scheduledJobEndpoints(apiRouter);
outlookAgentEndpoints(apiRouter);
googleAgentSkillEndpoints(apiRouter);
memoryEndpoints(apiRouter);
meetingsEndpoints(apiRouter, {
  runtime: meetingRuntime,
  prisma: require("./utils/prisma"),
});
createWeComAuthEndpoints(apiRouter, { auth: meetingWecomAuth });
meetingGatewayEndpoints(apiRouter, {
  sessions: meetingSessions,
  employeeAuth: meetingEmployeeAuth,
  oauth: app.locals.meetingGateway.oauth,
  enabled: app.locals.meetingGateway.enabled,
  contractConfirmed: app.locals.meetingGateway.contractConfirmed,
});
// Externally facing embedder endpoints
embeddedEndpoints(apiRouter);

// Externally facing browser extension endpoints
browserExtensionEndpoints(apiRouter);

if (process.env.NODE_ENV !== "development") {
  const { MetaGenerator } = require("./utils/boot/MetaGenerator");
  const IndexPage = new MetaGenerator();

  app.use(
    express.static(path.resolve(__dirname, "public"), {
      extensions: ["js"],
      setHeaders: (res) => {
        // Disable I-framing of entire site UI
        res.removeHeader("X-Powered-By");
        res.setHeader("X-Frame-Options", "DENY");
      },
    })
  );

  app.get("/robots.txt", function (_, response) {
    response.type("text/plain");
    response.send("User-agent: *\nDisallow: /").end();
  });

  app.get("/manifest.json", async function (_, response) {
    IndexPage.generateManifest(response);
    return;
  });

  app.use("/", function (_, response) {
    IndexPage.generate(response);
    return;
  });
} else {
  // Debug route for development connections to vectorDBs
  apiRouter.post("/v/:command", async (request, response) => {
    try {
      const VectorDb = getVectorDbClass();
      const { command } = request.params;
      if (!Object.getOwnPropertyNames(VectorDb).includes(command)) {
        response.status(500).json({
          message: "invalid interface command",
          commands: Object.getOwnPropertyNames(VectorDb),
        });
        return;
      }

      try {
        const body = reqBody(request);
        const resBody = await VectorDb[command](body);
        response.status(200).json({ ...resBody });
      } catch (e) {
        // console.error(e)
        console.error(JSON.stringify(e));
        response.status(500).json({ error: e.message });
      }
      return;
    } catch (e) {
      console.error(e.message, e);
      response.sendStatus(500).end();
    }
  });
}

app.all("*", function (_, response) {
  response.sendStatus(404);
});

// In non-https mode we need to boot at the end since the server has not yet
// started and is `.listen`ing.
if (!process.env.ENABLE_HTTPS) {
  bootedServer = bootHTTP(app, process.env.SERVER_PORT || 3001).server;
}
attachMeetingRuntime(bootedServer, meetingRuntime);
