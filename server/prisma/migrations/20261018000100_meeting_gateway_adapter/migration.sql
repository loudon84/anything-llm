-- CreateTable
CREATE TABLE "meeting_gateway_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anything_user_id" INTEGER NOT NULL,
    "gateway_org_id" TEXT NOT NULL,
    "gateway_member_id" TEXT NOT NULL,
    "gateway_user_id" TEXT NOT NULL,
    "identity_issuer" TEXT NOT NULL DEFAULT 'account-login-v1',
    "status" TEXT NOT NULL DEFAULT 'BOUND',
    "verified_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "meeting_gateway_bindings_anything_user_id_fkey" FOREIGN KEY ("anything_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_bridge_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anything_user_id" INTEGER NOT NULL,
    "session_binding_hmac" TEXT NOT NULL,
    "ciphertext" BLOB NOT NULL,
    "nonce" BLOB NOT NULL,
    "key_id" TEXT NOT NULL,
    "gateway_expiry" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    CONSTRAINT "meeting_bridge_sessions_anything_user_id_fkey" FOREIGN KEY ("anything_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_query_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anything_user_id" INTEGER NOT NULL,
    "gateway_member_id" TEXT NOT NULL,
    "connection_ref" TEXT NOT NULL,
    "selection" TEXT NOT NULL DEFAULT 'USER_WINDOW',
    "window_start" DATETIME NOT NULL,
    "window_end" DATETIME NOT NULL,
    "gateway_job_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "last_reason" TEXT,
    "last_error_code" TEXT,
    "progress" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "idempotency_key" TEXT NOT NULL,
    CONSTRAINT "meeting_query_runs_anything_user_id_fkey" FOREIGN KEY ("anything_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anything_user_id" INTEGER NOT NULL,
    "gateway_org_id" TEXT NOT NULL,
    "gateway_member_id" TEXT NOT NULL,
    "connection_ref" TEXT NOT NULL,
    "gateway_meeting_id" TEXT NOT NULL,
    "gateway_recording_id" TEXT NOT NULL,
    "gateway_asset_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "formatter_version" TEXT NOT NULL DEFAULT 'v1',
    "workspace_slug" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "identity_key" TEXT NOT NULL,
    "active_generation" INTEGER,
    "current_generation" INTEGER NOT NULL DEFAULT 0,
    "document_location" TEXT,
    "last_applied_doc_sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "access_state" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "verified_at" DATETIME,
    "source_verified_at" DATETIME,
    "last_error_code" TEXT,
    CONSTRAINT "meeting_imports_anything_user_id_fkey" FOREIGN KEY ("anything_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "meeting_imports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_import_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "import_id" TEXT,
    "request_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "retry_after" DATETIME,
    "evidence_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_error_code" TEXT,
    CONSTRAINT "meeting_import_attempts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "meeting_imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_import_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operation_id" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "trace_id" TEXT,
    "gateway_job_id_digest" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" TEXT
);

-- CreateTable
CREATE TABLE "meeting_restricted_workspaces" (
    "workspace_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_user_id" INTEGER NOT NULL,
    "policy_epoch" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "meeting_restricted_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "meeting_restricted_workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_oauth_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "bridge_session_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_oauth_transactions_bridge_session_id_fkey" FOREIGN KEY ("bridge_session_id") REFERENCES "meeting_bridge_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_import_generations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "import_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "operation_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "document_location" TEXT,
    "vector_doc_id" TEXT,
    "last_applied_doc_sha256" TEXT,
    "container_sha256" TEXT,
    "policy_epoch" INTEGER NOT NULL,
    "lease_owner" TEXT,
    "lease_deadline" DATETIME,
    "fencing_token" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "meeting_import_generations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "meeting_imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_gateway_bindings_anything_user_id_key" ON "meeting_gateway_bindings"("anything_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_gateway_bindings_anything_user_id_gateway_org_id_key" ON "meeting_gateway_bindings"("anything_user_id", "gateway_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_gateway_bindings_gateway_org_id_gateway_member_id_key" ON "meeting_gateway_bindings"("gateway_org_id", "gateway_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_bridge_sessions_session_binding_hmac_key" ON "meeting_bridge_sessions"("session_binding_hmac");

-- CreateIndex
CREATE INDEX "meeting_bridge_sessions_anything_user_id_revoked_at_idx" ON "meeting_bridge_sessions"("anything_user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_query_runs_idempotency_key_key" ON "meeting_query_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "meeting_query_runs_anything_user_id_submitted_at_idx" ON "meeting_query_runs"("anything_user_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_imports_identity_key_key" ON "meeting_imports"("identity_key");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_imports_document_location_key" ON "meeting_imports"("document_location");

-- CreateIndex
CREATE INDEX "meeting_imports_workspace_id_status_access_state_idx" ON "meeting_imports"("workspace_id", "status", "access_state");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_imports_anything_user_id_connection_ref_gateway_asset_id_content_type_source_version_workspace_id_key" ON "meeting_imports"("anything_user_id", "connection_ref", "gateway_asset_id", "content_type", "source_version", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_import_attempts_operation_id_key" ON "meeting_import_attempts"("operation_id");

-- CreateIndex
CREATE INDEX "meeting_import_attempts_request_id_idx" ON "meeting_import_attempts"("request_id");

-- CreateIndex
CREATE INDEX "meeting_import_attempts_import_id_created_at_idx" ON "meeting_import_attempts"("import_id", "created_at");

-- CreateIndex
CREATE INDEX "meeting_import_audits_owner_user_id_timestamp_idx" ON "meeting_import_audits"("owner_user_id", "timestamp");

-- CreateIndex
CREATE INDEX "meeting_import_audits_operation_id_idx" ON "meeting_import_audits"("operation_id");

-- CreateIndex
CREATE INDEX "meeting_restricted_workspaces_owner_user_id_state_idx" ON "meeting_restricted_workspaces"("owner_user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_oauth_transactions_transaction_id_key" ON "meeting_oauth_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "meeting_oauth_transactions_bridge_session_id_state_idx" ON "meeting_oauth_transactions"("bridge_session_id", "state");

-- CreateIndex
CREATE INDEX "meeting_oauth_transactions_owner_user_id_expires_at_idx" ON "meeting_oauth_transactions"("owner_user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_import_generations_operation_id_key" ON "meeting_import_generations"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_import_generations_document_location_key" ON "meeting_import_generations"("document_location");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_import_generations_vector_doc_id_key" ON "meeting_import_generations"("vector_doc_id");

-- CreateIndex
CREATE INDEX "meeting_import_generations_state_lease_deadline_idx" ON "meeting_import_generations"("state", "lease_deadline");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_import_generations_import_id_generation_key" ON "meeting_import_generations"("import_id", "generation");

-- Only one unexpired authorization transaction may be pending for a bridge at a time.
CREATE UNIQUE INDEX "meeting_oauth_one_pending_per_bridge_key"
ON "meeting_oauth_transactions"("bridge_session_id")
WHERE "state" = 'PENDING';
