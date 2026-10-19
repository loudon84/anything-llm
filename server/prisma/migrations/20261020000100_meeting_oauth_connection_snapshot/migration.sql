ALTER TABLE "meeting_oauth_transactions"
ADD COLUMN "existing_connection_ids" TEXT NOT NULL DEFAULT '[]';
