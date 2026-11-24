-- Database-side UUID defaults so raw-SQL inserts (PostGIS columns) get ids without
-- relying on Prisma's client-side generation. Idempotent.
ALTER TABLE "cities" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "vehicle_types" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "user_profiles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "user_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "otp_verifications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "device_tokens" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "user_vehicles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "journeys" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "journey_locations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "journey_routes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "journey_matches" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "route_segments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "traffic_snapshots" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "hotspot_aggregations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ride_pool_offers" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ride_pool_requests" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "ride_pool_members" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "notifications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "saved_places" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "saved_routes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "idempotency_records" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
