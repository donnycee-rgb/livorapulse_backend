-- Daily period logging and an opt-in cycle tracker
CREATE TABLE "PeriodDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "flow" TEXT,
    "symptoms" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PeriodDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PeriodDay_userId_date_key" ON "PeriodDay"("userId", "date");
ALTER TABLE "PeriodDay" ADD CONSTRAINT "PeriodDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserProfile" ADD COLUMN "cycleTracking" BOOLEAN;

-- Every period logged so far becomes its days: the start day keeps the flow,
-- symptoms and notes that were logged; the other days are plain period days
INSERT INTO "PeriodDay" ("id", "userId", "date", "flow", "symptoms", "notes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."userId", (c."periodStartDate" AT TIME ZONE 'UTC')::date + g.i,
       CASE WHEN g.i = 0 THEN c."flowIntensity" END,
       CASE WHEN g.i = 0 THEN c."symptoms" END,
       CASE WHEN g.i = 0 THEN c."notes" END,
       c."createdAt", CURRENT_TIMESTAMP
FROM "CycleLog" c
CROSS JOIN LATERAL generate_series(0, GREATEST(c."periodDuration", 1) - 1) AS g(i)
ON CONFLICT ("userId", "date") DO NOTHING;
