const { MeetingError } = require("./errors");

const PRIVATE_FIELDS = ["secretId", "secretKey", "stsToken", "ocrToken"];

function parseConfig(value) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value || {};
  } catch {
    throw new MeetingError(
      "Meeting connection configuration is invalid",
      "INVALID_MEETING_CONFIG",
      500
    );
  }
}

function createMeetingConfig({
  prisma,
  encryption,
  audit = async () => {},
} = {}) {
  if (!prisma?.meeting_connections)
    throw new TypeError("createMeetingConfig requires a Prisma client");
  if (!encryption?.encrypt || !encryption?.decrypt)
    throw new TypeError(
      "Meeting credentials require encryption.encrypt and encryption.decrypt"
    );
  let selectedId = null;

  const transaction = (callback) =>
    prisma.$transaction ? prisma.$transaction(callback) : callback(prisma);

  async function findConnection(id) {
    if (id != null)
      return prisma.meeting_connections.findUnique
        ? prisma.meeting_connections.findUnique({ where: { id: Number(id) } })
        : prisma.meeting_connections.findFirst({ where: { id: Number(id) } });
    return prisma.meeting_connections.findFirst({ orderBy: { id: "asc" } });
  }

  async function getPrivate(id) {
    const row = await findConnection(id ?? selectedId);
    if (!row) return null;
    const stored = parseConfig(row.config);
    let credentials = {};
    if (stored.credentials) {
      try {
        credentials = JSON.parse(await encryption.decrypt(stored.credentials));
      } catch {
        throw new MeetingError(
          "Meeting connection credentials could not be decrypted",
          "MEETING_CREDENTIALS_UNAVAILABLE",
          500
        );
      }
    }
    const services = stored.settings?.services || {};
    return {
      ...stored.settings,
      ...credentials,
      services: {
        ...services,
        ...(services.ocr
          ? { ocr: { ...services.ocr, token: credentials.ocrToken || "" } }
          : {}),
      },
      id: row.id,
      name: row.name,
    };
  }

  async function getPublic(id) {
    const row = await findConnection(id ?? selectedId);
    if (!row) return null;
    selectedId = row.id;
    const stored = parseConfig(row.config);
    const settings = stored.settings || {};
    return {
      id: row.id,
      name: row.name,
      configured: Boolean(stored.credentials),
      ...Object.fromEntries(
        ["appId", "sdkId", "operatorId"].flatMap((field) =>
          settings[field] == null ? [] : [[field, settings[field]]]
        )
      ),
      ...(settings.userId ? { userId: settings.userId } : {}),
      ...(settings.operatorIdType != null
        ? { operatorIdType: settings.operatorIdType }
        : {}),
      capabilities: settings.capabilities || {},
      credentialHints: stored.credentialHints || {},
      ...(settings.services
        ? {
            services: {
              ...settings.services,
              ...(settings.services.ocr
                ? {
                    ocr: {
                      url: settings.services.ocr.url,
                      configured: Boolean(settings.services.ocr.url),
                      tokenPresent: Boolean(
                        credentialsHint(stored, "ocrToken")
                      ),
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  }

  async function save(input = {}, userId) {
    const id = input.id == null ? undefined : Number(input.id);
    const name = String(input.name || "Tencent Meeting").trim();
    if (!name)
      throw new MeetingError(
        "A connection name is required",
        "INVALID_CONNECTION_NAME"
      );
    const existing = id == null ? null : await findConnection(id);
    const old = existing ? parseConfig(existing.config) : {};
    const credentials = {};
    let priorCredentials = {};
    if (existing?.config) {
      const prior = parseConfig(existing.config);
      if (prior.credentials) {
        try {
          priorCredentials = JSON.parse(
            await encryption.decrypt(prior.credentials)
          );
        } catch {
          throw new MeetingError(
            "Meeting connection credentials could not be decrypted",
            "MEETING_CREDENTIALS_UNAVAILABLE",
            500
          );
        }
      }
    }
    for (const field of PRIVATE_FIELDS) {
      const supplied =
        field === "ocrToken"
          ? (input.services?.ocr?.token ?? input.ocrToken)
          : input[field];
      if (supplied != null && supplied !== "")
        credentials[field] = String(supplied);
      else if (priorCredentials[field])
        credentials[field] = priorCredentials[field];
    }
    const encrypted = Object.keys(credentials).length
      ? await encryption.encrypt(JSON.stringify(credentials))
      : null;
    const settings = {};
    for (const field of [
      "appId",
      "sdkId",
      "userId",
      "operatorId",
      "operatorIdType",
      "instanceId",
      "capabilities",
    ]) {
      if (input[field] != null) settings[field] = input[field];
      else if (old.settings?.[field] != null)
        settings[field] = old.settings[field];
    }
    const ocrInput = input.services?.ocr;
    const priorOcr = old.settings?.services?.ocr || {};
    if (ocrInput || priorOcr.url) {
      const url = ocrInput?.url ?? priorOcr.url ?? "";
      if (url) {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          throw new MeetingError(
            "OCR parser URL must be an absolute URL",
            "INVALID_MEETING_CONFIG"
          );
        }
        if (
          !new Set(["https:", "http:"]).has(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.pathname.replace(/\/$/, "") !== "/parse"
        )
          throw new MeetingError(
            "OCR parser URL must be an HTTP(S) /parse endpoint without URL credentials",
            "INVALID_MEETING_CONFIG"
          );
      }
      settings.services = {
        ...(old.settings?.services || {}),
        ocr: { url, configured: Boolean(url) },
      };
    } else if (old.settings?.services)
      settings.services = old.settings.services;
    const credentialHints = Object.fromEntries(
      PRIVATE_FIELDS.filter((field) => credentials[field]).map((field) => [
        field,
        `••••${credentials[field].slice(-4)}`,
      ])
    );
    const config = JSON.stringify({
      settings,
      credentials: encrypted,
      credentialHints,
    });
    const data = { name, config };
    const row = await transaction(async (tx) => {
      let saved;
      if (tx.meeting_connections.upsert && id != null) {
        saved = await tx.meeting_connections.upsert({
          where: { id },
          create: data,
          update: data,
        });
      } else if (id != null && existing) {
        saved = await tx.meeting_connections.update({ where: { id }, data });
      } else {
        saved = await tx.meeting_connections.create({ data });
      }
      await audit(
        {
          action: "MEETING_CONNECTION_SAVED",
          connectionId: saved.id,
          userId: userId ?? null,
          name,
        },
        tx
      );
      return saved;
    });
    selectedId = row.id;
    return getPublic(row.id);
  }

  return { getPublic, save, getPrivate };
}

function credentialsHint(stored, field) {
  return stored.credentialHints?.[field] || null;
}

module.exports = { createMeetingConfig };
