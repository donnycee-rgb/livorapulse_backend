-- Other activities (type, minutes, step-goal credit) and naps vs last night's sleep
ALTER TABLE "PhysicalActivityEntry" ADD COLUMN "sleepType" TEXT;
ALTER TABLE "PhysicalActivityEntry" ADD COLUMN "activityType" TEXT;
ALTER TABLE "PhysicalActivityEntry" ADD COLUMN "durationMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PhysicalActivityEntry" ADD COLUMN "stepEquivalent" INTEGER NOT NULL DEFAULT 0;

-- Sleep logged before this change was always last night's
UPDATE "PhysicalActivityEntry" SET "sleepType" = 'night'
WHERE "sleepMinutes" > 0 AND "steps" = 0 AND "distanceKm" = 0;
