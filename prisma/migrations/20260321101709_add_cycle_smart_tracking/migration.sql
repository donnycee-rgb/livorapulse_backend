-- AlterTable
ALTER TABLE "CycleLog" ADD COLUMN     "actualCycleLength" INTEGER;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "defaultCycleLength" INTEGER,
ADD COLUMN     "defaultPeriodDuration" INTEGER;
