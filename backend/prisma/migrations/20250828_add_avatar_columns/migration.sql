-- Add avatar storage columns to profiles table
ALTER TABLE "profiles" 
ADD COLUMN IF NOT EXISTS "avatarPath" TEXT,
ADD COLUMN IF NOT EXISTS "avatarMimeType" TEXT,
ADD COLUMN IF NOT EXISTS "avatarSize" INTEGER;