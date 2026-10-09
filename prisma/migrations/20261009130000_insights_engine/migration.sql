-- CreateTable
CREATE TABLE "DailyFeatures" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sleepMinutes" INTEGER,
    "steps" INTEGER,
    "distanceKm" DOUBLE PRECISION,
    "activeCaloriesKcal" INTEGER,
    "screenMinutes" INTEGER,
    "socialMinutes" INTEGER,
    "entertainmentMinutes" INTEGER,
    "focusMinutes" INTEGER,
    "studyMinutes" INTEGER,
    "moodValue" DOUBLE PRECISION,
    "stressScore" DOUBLE PRECISION,
    "caloriesIn" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "waterGlasses" INTEGER,
    "ecoActions" INTEGER,
    "cyclePhase" TEXT,
    "cycleDay" INTEGER,
    "symptoms" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyFeatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "lag" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "effect" DOUBLE PRECISION NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "rho" DOUBLE PRECISION,
    "groupLabelLow" TEXT NOT NULL,
    "groupLabelHigh" TEXT NOT NULL,
    "meanLow" DOUBLE PRECISION NOT NULL,
    "meanHigh" DOUBLE PRECISION NOT NULL,
    "nDays" INTEGER NOT NULL,
    "qValue" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "feedback" TEXT,
    "dismissedEffect" DOUBLE PRECISION,
    "firstFoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyFeatures_userId_date_idx" ON "DailyFeatures"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyFeatures_userId_date_key" ON "DailyFeatures"("userId", "date");

-- CreateIndex
CREATE INDEX "Insight_userId_status_idx" ON "Insight"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Insight_userId_key_key" ON "Insight"("userId", "key");

-- AddForeignKey
ALTER TABLE "DailyFeatures" ADD CONSTRAINT "DailyFeatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

