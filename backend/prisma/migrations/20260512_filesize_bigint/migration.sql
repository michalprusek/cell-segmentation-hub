-- ND2 / TIFF stacks routinely exceed 2 GB; the previous Int (INT4) column
-- caused Prisma "Unable to fit '2499837952' into INT4" failures on upload.
-- 2^31-1 = 2,147,483,647 bytes ≈ 2.0 GB; BIGINT covers up to ~9 EB.
ALTER TABLE "images" ALTER COLUMN "fileSize" TYPE BIGINT;
