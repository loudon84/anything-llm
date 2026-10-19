PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TABLE "users_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT,
    "password" TEXT,
    "pfpFilename" TEXT,
    "role" TEXT NOT NULL DEFAULT 'default',
    "suspended" INTEGER NOT NULL DEFAULT 0,
    "seen_recovery_codes" BOOLEAN DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dailyMessageLimit" INTEGER,
    "bio" TEXT DEFAULT '',
    "web_push_subscription_config" TEXT
);
INSERT INTO "users_new" (
  "id", "username", "password", "pfpFilename", "role", "suspended",
  "seen_recovery_codes", "createdAt", "lastUpdatedAt", "dailyMessageLimit",
  "bio", "web_push_subscription_config"
)
SELECT "id", "username", "password", "pfpFilename", "role", "suspended",
       "seen_recovery_codes", "createdAt", "lastUpdatedAt", "dailyMessageLimit",
       "bio", "web_push_subscription_config"
FROM "users";
DROP TABLE "users";
ALTER TABLE "users_new" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

DROP INDEX "meeting_gateway_bindings_anything_user_id_key";
DROP INDEX "meeting_gateway_bindings_anything_user_id_gateway_org_id_key";
DROP INDEX "meeting_gateway_bindings_gateway_org_id_gateway_member_id_key";
CREATE TABLE "meeting_gateway_bindings_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anything_user_id" INTEGER NOT NULL,
    "gateway_instance_id" TEXT,
    "gateway_org_id" TEXT NOT NULL,
    "gateway_member_id" TEXT NOT NULL,
    "gateway_user_id" TEXT NOT NULL,
    "identity_issuer" TEXT NOT NULL DEFAULT 'account-login-v1',
    "display_name" TEXT,
    "gateway_active" BOOLEAN,
    "credential_epoch" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'BOUND',
    "verified_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "meeting_gateway_bindings_anything_user_id_fkey" FOREIGN KEY ("anything_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "meeting_gateway_bindings_new" (
  "id", "anything_user_id", "gateway_instance_id", "gateway_org_id", "gateway_member_id",
  "gateway_user_id", "identity_issuer", "status", "verified_at", "created_at", "updated_at"
)
SELECT "id", "anything_user_id", NULL, "gateway_org_id", "gateway_member_id",
       "gateway_user_id", "identity_issuer", "status", "verified_at", "created_at", "updated_at"
FROM "meeting_gateway_bindings";
DROP TABLE "meeting_gateway_bindings";
ALTER TABLE "meeting_gateway_bindings_new" RENAME TO "meeting_gateway_bindings";
CREATE UNIQUE INDEX "meeting_gateway_bindings_anything_user_id_key" ON "meeting_gateway_bindings"("anything_user_id");
CREATE UNIQUE INDEX "meeting_gateway_bindings_anything_user_id_gateway_org_id_key" ON "meeting_gateway_bindings"("anything_user_id", "gateway_org_id");
CREATE UNIQUE INDEX "meeting_gateway_bindings_gateway_instance_id_gateway_org_id_gateway_member_id_key" ON "meeting_gateway_bindings"("gateway_instance_id", "gateway_org_id", "gateway_member_id");

CREATE TABLE "meeting_login_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "binding_id" TEXT NOT NULL,
    "credential_epoch" INTEGER NOT NULL DEFAULT 1,
    "token_hash" TEXT,
    "browser_proof_hash" TEXT,
    "identity_expires_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "remote_access_mode" TEXT NOT NULL DEFAULT 'GATEWAY_ENABLED',
    "local_only_reason" TEXT,
    "auth_method" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    CONSTRAINT "meeting_login_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "meeting_login_sessions_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "meeting_gateway_bindings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "meeting_login_sessions_user_id_revoked_at_expires_at_idx" ON "meeting_login_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "meeting_login_sessions_binding_id_credential_epoch_idx" ON "meeting_login_sessions"("binding_id", "credential_epoch");

CREATE TABLE "meeting_sso_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT NOT NULL UNIQUE,
    "local_session_id" TEXT,
    "client_state_hash" TEXT NOT NULL,
    "browser_proof_hash" TEXT NOT NULL,
    "verifier_ciphertext" BLOB NOT NULL,
    "verifier_nonce" BLOB NOT NULL,
    "ticket_ciphertext" BLOB,
    "ticket_nonce" BLOB,
    "crypto_key_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "remote_access_mode" TEXT NOT NULL DEFAULT 'GATEWAY_ENABLED',
    "local_only_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" DATETIME,
    CONSTRAINT "meeting_sso_transactions_local_session_id_fkey" FOREIGN KEY ("local_session_id") REFERENCES "meeting_login_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "meeting_sso_transactions_state_expires_at_idx" ON "meeting_sso_transactions"("state", "expires_at");
CREATE INDEX "meeting_sso_transactions_local_session_id_idx" ON "meeting_sso_transactions"("local_session_id");

COMMIT;
PRAGMA foreign_keys=ON;
