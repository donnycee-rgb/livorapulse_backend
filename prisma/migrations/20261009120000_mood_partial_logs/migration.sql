-- A check-in can record mood only or stress only; the other stays null
ALTER TABLE "MoodLog" ALTER COLUMN "emoji" DROP NOT NULL,
ALTER COLUMN "stressScore" DROP NOT NULL;
