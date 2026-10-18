ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "jwt_binding_hmac" TEXT NOT NULL DEFAULT '';
ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "csrf_hmac" TEXT NOT NULL DEFAULT '';
ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "credential_binding_hmac" TEXT NOT NULL DEFAULT '';
ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "ms_expiry" DATETIME;
ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "mt_expiry" DATETIME;
ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "jwt_expiry" DATETIME;
ALTER TABLE "meeting_bridge_sessions" ADD COLUMN "session_expiry" DATETIME;
