-- CreateTable
CREATE TABLE "MlModelRun" (
    "id" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "users" INTEGER NOT NULL DEFAULT 0,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "population" JSONB,
    "metrics" JSONB,
    "error" TEXT,

    CONSTRAINT "MlModelRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlUserEffect" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "sd" DOUBLE PRECISION NOT NULL,
    "probPositive" DOUBLE PRECISION NOT NULL,
    "ownShare" DOUBLE PRECISION NOT NULL,
    "claim" TEXT NOT NULL,
    "nDays" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlUserEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlPrediction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "lower" DOUBLE PRECISION NOT NULL,
    "upper" DOUBLE PRECISION NOT NULL,
    "nDays" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MlUserEffect_userId_outcome_idx" ON "MlUserEffect"("userId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "MlUserEffect_userId_outcome_feature_key" ON "MlUserEffect"("userId", "outcome", "feature");

-- CreateIndex
CREATE INDEX "MlPrediction_userId_date_idx" ON "MlPrediction"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MlPrediction_userId_date_outcome_key" ON "MlPrediction"("userId", "date", "outcome");

-- AddForeignKey
ALTER TABLE "MlUserEffect" ADD CONSTRAINT "MlUserEffect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlPrediction" ADD CONSTRAINT "MlPrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

