-- Bug reports + feature requests submitted by authenticated users via
-- the in-app feedback button. The row is the source of truth; the email
-- notification to the maintainer (separate service path) is best-effort.
--
-- emailSentAt stays NULL until SMTP delivery succeeds — UTIA mail server
-- has 2-10 min processing delays so the request doesn't block on it.
--
-- onDelete: SET NULL on userId preserves the report when a user is
-- soft-anonymised (GDPR delete) — better than cascade-deleting feedback
-- the maintainer may already be triaging.

CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentPath" TEXT,
    "attachmentMime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedbacks_type_check" CHECK ("type" IN ('bug', 'feature')),
    CONSTRAINT "feedbacks_status_check" CHECK ("status" IN ('new', 'triaged', 'in_progress', 'resolved'))
);

ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX "idx_feedback_user_created" ON "feedbacks" ("userId", "createdAt");
CREATE INDEX "idx_feedback_status_created" ON "feedbacks" ("status", "createdAt");
