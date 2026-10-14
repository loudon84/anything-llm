const { MeetingError } = require("./errors");

const PRIVATE_FIELDS = ["secretId", "secretKey", "stsToken"];

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
    return { ...stored.settings, ...credentials, id: row.id, name: row.name };
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
      ...(settings.userId ? { userId: settings.userId } : {}),
      ...(settings.operatorIdType != null
        ? { operatorIdType: settings.operatorIdType }
        : {}),
      capabilities: settings.capabilities || {},
      credentialHints: stored.credentialHints || {},
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
      if (input[field] != null && input[field] !== "")
        credentials[field] = String(input[field]);
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
    let row;
    if (prisma.meeting_connections.upsert && id != null) {
      row = await prisma.meeting_connections.upsert({
        where: { id },
        create: data,
        update: data,
      });
    } else if (id != null && existing) {
      row = await prisma.meeting_connections.update({ where: { id }, data });
    } else {
      row = await prisma.meeting_connections.create({ data });
    }
    selectedId = row.id;
    await audit({
      action: "MEETING_CONNECTION_SAVED",
      connectionId: row.id,
      userId: userId ?? null,
      name,
    });
    return getPublic(row.id);
  }

  return { getPublic, save, getPrivate };
}

module.exports = { createMeetingConfig };
