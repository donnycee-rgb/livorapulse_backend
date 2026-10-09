-- CreateTable
CREATE TABLE "SharedSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "includeNotes" BOOLEAN NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedSummary_tokenHash_key" ON "SharedSummary"("tokenHash");

-- CreateIndex
CREATE INDEX "SharedSummary_userId_idx" ON "SharedSummary"("userId");

-- CreateIndex
CREATE INDEX "SharedSummary_expiresAt_idx" ON "SharedSummary"("expiresAt");

-- AddForeignKey
ALTER TABLE "SharedSummary" ADD CONSTRAINT "SharedSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

