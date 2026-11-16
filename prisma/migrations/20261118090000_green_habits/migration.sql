-- Green habits and trips: a trip's distance, and an index for per-day lookups
ALTER TABLE "EcoAction" ADD COLUMN "distanceKm" DOUBLE PRECISION;
CREATE INDEX "EcoAction_userId_timestamp_idx" ON "EcoAction"("userId", "timestamp");
