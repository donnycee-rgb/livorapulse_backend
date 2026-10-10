-- The LifePulse Score now uses the last 7 days, and needs to tell "not logged
-- that day" (NULL) from a real score. Earlier versions saved 0 for every area
-- that wasn't logged, so those zeros become NULL. (A truly logged score of 0
-- was very rare and is treated as not logged for those old days.)
UPDATE "DailySummary" SET "physicalScore" = NULL WHERE "physicalScore" = 0;
UPDATE "DailySummary" SET "digitalScore" = NULL WHERE "digitalScore" = 0;
UPDATE "DailySummary" SET "productivityScore" = NULL WHERE "productivityScore" = 0;
UPDATE "DailySummary" SET "moodScore" = NULL WHERE "moodScore" = 0;
UPDATE "DailySummary" SET "ecoScore" = NULL WHERE "ecoScore" = 0;
UPDATE "DailySummary" SET "nutritionScore" = NULL WHERE "nutritionScore" = 0;
