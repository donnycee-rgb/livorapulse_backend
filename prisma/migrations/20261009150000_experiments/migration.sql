-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "splitValue" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insightKey" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "lag" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "baselineStart" TIMESTAMP(3) NOT NULL,
    "baselineEnd" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentCheckin" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "did" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Experiment_userId_status_idx" ON "Experiment"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentCheckin_experimentId_date_key" ON "ExperimentCheckin"("experimentId", "date");

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentCheckin" ADD CONSTRAINT "ExperimentCheckin_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

