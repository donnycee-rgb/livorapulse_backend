-- Bedtime and wake-up time for sleep logged with times
ALTER TABLE "PhysicalActivityEntry" ADD COLUMN "sleepStart" TIMESTAMP(3),
ADD COLUMN "sleepEnd" TIMESTAMP(3);
