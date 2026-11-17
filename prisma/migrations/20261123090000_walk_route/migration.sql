-- The walking journey: where it starts and its stops (no location is stored)
ALTER TABLE "UserProfile" ADD COLUMN "walkArea" TEXT,
ADD COLUMN "walkRoute" JSONB;
