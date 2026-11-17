-- Up to three main goals; existing users keep the one they chose
ALTER TABLE "UserProfile" ADD COLUMN "goals" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "UserProfile" SET "goals" = ARRAY["primaryGoal"] WHERE "primaryGoal" IS NOT NULL;
