-- CreateTable
CREATE TABLE "CycleLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "cycleLength" INTEGER NOT NULL DEFAULT 28,
    "periodDuration" INTEGER NOT NULL DEFAULT 5,
    "flowIntensity" TEXT,
    "symptoms" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CycleLog" ADD CONSTRAINT "CycleLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
