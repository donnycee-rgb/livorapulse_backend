-- "My period ended": the last day of the period the person said was over
ALTER TABLE "UserProfile" ADD COLUMN "periodEndedOn" TIMESTAMP(3);
