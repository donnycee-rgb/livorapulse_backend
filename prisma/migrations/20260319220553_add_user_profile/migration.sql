-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "hasDisability" BOOLEAN NOT NULL DEFAULT false,
    "disabilityNote" TEXT,
    "primaryGoal" TEXT,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "goalStepsPerDay" INTEGER,
    "goalSleepHours" DOUBLE PRECISION,
    "goalScreenMinutes" INTEGER,
    "goalFocusMinutes" INTEGER,
    "goalEcoActionsPerDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
