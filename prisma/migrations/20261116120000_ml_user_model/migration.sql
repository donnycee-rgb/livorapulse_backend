-- CreateTable
CREATE TABLE "MlUserModel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "nDays" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlUserModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MlUserModel_userId_outcome_key" ON "MlUserModel"("userId", "outcome");

-- AddForeignKey
ALTER TABLE "MlUserModel" ADD CONSTRAINT "MlUserModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

