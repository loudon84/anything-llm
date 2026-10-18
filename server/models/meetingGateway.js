const { randomUUID } = require("crypto");
const { ACCESS_STATES, assertTransition } = require("../utils/meetingGateway/lifecycle");

const IMPORT_FIELDS = [
  "anything_user_id",
  "gateway_org_id",
  "gateway_member_id",
  "gateway_user_id",
  "connection_ref",
  "gateway_meeting_id",
  "gateway_recording_id",
  "gateway_asset_id",
  "content_type",
  "source_version",
  "content_sha256",
  "workspace_slug",
  "workspace_id",
  "identity_key",
];
const GENERATION_PATCH_FIELDS = new Set([
  "state",
  "document_location",
  "vector_doc_id",
  "last_applied_doc_sha256",
  "container_sha256",
  "policy_epoch",
]);

function dateFromClock(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) throw new Error("MGW_INVALID_CLOCK");
  return date;
}

function requiredIdentity(input) {
  if (!input || IMPORT_FIELDS.some((field) => input[field] === undefined || input[field] === null))
    throw new Error("MGW_IDENTITY_INVALID");
  if (!Number.isInteger(input.anything_user_id) || !Number.isInteger(input.workspace_id))
    throw new Error("MGW_IDENTITY_INVALID");
  if (!["transcript", "minutes"].includes(input.content_type)) throw new Error("MGW_IDENTITY_INVALID");
  if (IMPORT_FIELDS.some((field) => typeof input[field] === "string" && !input[field].trim()))
    throw new Error("MGW_IDENTITY_INVALID");
}

function sameIdentity(row, input) {
  return IMPORT_FIELDS.every((field) => row[field] === input[field]);
}

function createMeetingStore({ prisma, clock = () => new Date() }) {
  if (!prisma || typeof prisma.$transaction !== "function") throw new Error("MGW_PRISMA_REQUIRED");
  const now = () => dateFromClock(clock);

  async function getById(db, table, id) {
    const rows = await db.$queryRawUnsafe(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, id);
    return rows[0] || null;
  }

  async function reserveIdentity(input) {
    requiredIdentity(input);
    const id = randomUUID();
    const timestamp = now();
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO meeting_imports (
            id, anything_user_id, gateway_org_id, gateway_member_id, connection_ref,
            gateway_meeting_id, gateway_recording_id, gateway_asset_id, content_type,
            source_version, content_sha256, workspace_slug, workspace_id, identity_key,
            current_generation, status, access_state, attempt_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', 'UNVERIFIED', 0, ?, ?)
          ON CONFLICT(identity_key) DO NOTHING`,
          id,
          input.anything_user_id,
          input.gateway_org_id,
          input.gateway_member_id,
          input.connection_ref,
          input.gateway_meeting_id,
          input.gateway_recording_id,
          input.gateway_asset_id,
          input.content_type,
          input.source_version,
          input.content_sha256,
          input.workspace_slug,
          input.workspace_id,
          input.identity_key,
          timestamp,
          timestamp
        );
        const rows = await tx.$queryRawUnsafe("SELECT * FROM meeting_imports WHERE identity_key = ?", input.identity_key);
        const existing = rows[0];
        if (!existing || !sameIdentity(existing, input)) throw new Error("MGW_IDENTITY_BINDING_CONFLICT");
        return existing;
      });
    } catch (error) {
      if (error.message === "MGW_IDENTITY_BINDING_CONFLICT") throw error;
      const existing = (await prisma.$queryRawUnsafe("SELECT * FROM meeting_imports WHERE identity_key = ?", input.identity_key))[0];
      if (existing && sameIdentity(existing, input)) return existing;
      const boundMember = (
        await prisma.$queryRawUnsafe(
          "SELECT id FROM meeting_imports WHERE gateway_org_id = ? AND gateway_member_id = ? AND anything_user_id <> ? LIMIT 1",
          input.gateway_org_id,
          input.gateway_member_id,
          input.anything_user_id
        )
      )[0];
      if (boundMember) throw new Error("MGW_IDENTITY_BINDING_CONFLICT");
      throw error;
    }
  }

  async function claimGeneration(importId) {
    return prisma.$transaction(async (tx) => {
      const imported = await getById(tx, "meeting_imports", importId);
      if (!imported) throw new Error("MGW_IMPORT_NOT_FOUND");
      const policy = (
        await tx.$queryRawUnsafe("SELECT * FROM meeting_restricted_workspaces WHERE workspace_id = ?", imported.workspace_id)
      )[0];
      if (!policy || policy.owner_user_id !== imported.anything_user_id || policy.state !== "ACTIVE")
        throw new Error("MGW_WORKSPACE_POLICY_REQUIRED");

      const generationNumber = imported.current_generation + 1;
      if (imported.current_generation > 0) {
        const previous = (
          await tx.$queryRawUnsafe(
            "SELECT * FROM meeting_import_generations WHERE import_id = ? AND generation = ?",
            importId,
            imported.current_generation
          )
        )[0];
        if (!previous || ["PENDING_CLEANUP", "REVOKING"].includes(previous.state))
          throw new Error("MGW_CLEANUP_IN_PROGRESS");
        if (previous.state !== "REMOVED") throw new Error("MGW_IMPORT_CONFLICT");
      }

      const updated = await tx.$executeRawUnsafe(
        "UPDATE meeting_imports SET current_generation = ?, status = 'PENDING', updated_at = ? WHERE id = ? AND current_generation = ?",
        generationNumber,
        now(),
        importId,
        imported.current_generation
      );
      if (updated !== 1) throw new Error("MGW_IMPORT_CONFLICT");

      const id = randomUUID();
      const operationId = randomUUID();
      const timestamp = now();
      await tx.$executeRawUnsafe(
        `INSERT INTO meeting_import_generations (
          id, import_id, generation, operation_id, state, policy_epoch, fencing_token, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'PENDING', ?, 0, ?, ?)`,
        id,
        importId,
        generationNumber,
        operationId,
        policy.policy_epoch,
        timestamp,
        timestamp
      );
      return getById(tx, "meeting_import_generations", id);
    });
  }

  async function acquireLease(generationId, workerId) {
    if (typeof workerId !== "string" || !workerId.trim()) throw new Error("MGW_WORKER_ID_REQUIRED");
    return prisma.$transaction(async (tx) => {
      const timestamp = now();
      const deadline = new Date(timestamp.getTime() + 60_000);
      const updated = await tx.$executeRawUnsafe(
        `UPDATE meeting_import_generations
         SET lease_owner = ?, lease_deadline = ?,
         fencing_token = CASE WHEN lease_owner = ? AND lease_deadline > ? THEN fencing_token ELSE fencing_token + 1 END,
         updated_at = ?
         WHERE id = ? AND (lease_deadline IS NULL OR lease_deadline <= ? OR lease_owner = ?)`,
        workerId,
        deadline,
        workerId,
        timestamp,
        timestamp,
        generationId,
        timestamp,
        workerId
      );
      if (updated !== 1) {
        if (!(await getById(tx, "meeting_import_generations", generationId))) throw new Error("MGW_GENERATION_NOT_FOUND");
        throw new Error("MGW_LEASE_HELD");
      }
      return getById(tx, "meeting_import_generations", generationId);
    });
  }

  async function commitGeneration(generationId, fence, patch) {
    if (!Number.isInteger(fence) || !patch || typeof patch !== "object") throw new Error("MGW_GENERATION_PATCH_INVALID");
    const keys = Object.keys(patch);
    if (keys.some((key) => !GENERATION_PATCH_FIELDS.has(key))) throw new Error("MGW_GENERATION_PATCH_INVALID");

    return prisma.$transaction(async (tx) => {
      const existing = await getById(tx, "meeting_import_generations", generationId);
      if (!existing) throw new Error("MGW_GENERATION_NOT_FOUND");
      if (patch.state !== undefined) assertTransition(existing.state, patch.state);
      const timestamp = now();
      const fields = [...keys, "updated_at"];
      const values = [...keys.map((key) => patch[key]), timestamp, generationId, fence, timestamp];
      const assignments = [...keys.map((key) => `"${key}" = ?`), '"updated_at" = ?'].join(", ");
      const updated = await tx.$executeRawUnsafe(
        `UPDATE meeting_import_generations SET ${assignments} WHERE id = ? AND fencing_token = ? AND lease_deadline > ?`,
        ...values
      );
      if (updated !== 1) throw new Error("MGW_STALE_FENCE");
      const committed = await getById(tx, "meeting_import_generations", generationId);
      if (patch.state !== undefined) {
        const parentUpdates = ["status = ?"];
        const parentValues = [patch.state];
        if (patch.state === "VERIFIED") {
          parentUpdates.push("active_generation = ?", "document_location = ?", "last_applied_doc_sha256 = ?");
          parentValues.push(
            committed.generation,
            committed.document_location,
            committed.last_applied_doc_sha256
          );
        } else if (patch.state === "REMOVED") {
          parentUpdates.push("active_generation = NULL", "document_location = NULL", "last_applied_doc_sha256 = NULL");
        } else {
          if (Object.hasOwn(patch, "document_location")) {
            parentUpdates.push("document_location = ?");
            parentValues.push(patch.document_location);
          }
          if (Object.hasOwn(patch, "last_applied_doc_sha256")) {
            parentUpdates.push("last_applied_doc_sha256 = ?");
            parentValues.push(patch.last_applied_doc_sha256);
          }
        }
        parentUpdates.push("updated_at = ?");
        parentValues.push(timestamp, committed.import_id);
        await tx.$executeRawUnsafe(
          `UPDATE meeting_imports SET ${parentUpdates.join(", ")} WHERE id = ?`,
          ...parentValues
        );
      }
      return committed;
    });
  }

  async function markAccess(importId, state) {
    if (!ACCESS_STATES.includes(state)) throw new Error("MGW_INVALID_ACCESS_STATE");
    const updated = await prisma.$executeRawUnsafe(
      "UPDATE meeting_imports SET access_state = ?, updated_at = ? WHERE id = ?",
      state,
      now(),
      importId
    );
    if (updated !== 1) throw new Error("MGW_IMPORT_NOT_FOUND");
    return getById(prisma, "meeting_imports", importId);
  }

  async function policyByWorkspace(workspaceId) {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT * FROM meeting_restricted_workspaces WHERE workspace_id = ? LIMIT 1",
      workspaceId
    );
    return rows[0] || null;
  }

  return { acquireLease, claimGeneration, commitGeneration, markAccess, policyByWorkspace, reserveIdentity };
}

module.exports = { createMeetingStore };
