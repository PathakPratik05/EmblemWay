-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JourneyPurpose" AS ENUM ('COMMUTE', 'BUSINESS', 'EDUCATION', 'LEISURE', 'ERRAND', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('SOURCE', 'DESTINATION', 'PICKUP');

-- CreateEnum
CREATE TYPE "RoutingProfile" AS ENUM ('DRIVE', 'TWO_WHEELER', 'BICYCLE', 'WALK');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('SAME_ROUTE', 'SAME_DESTINATION', 'SHARED_START', 'PARTIAL_OVERLAP');

-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TrafficEstimateStatus" AS ENUM ('OK', 'UNSUPPORTED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "HotspotModel" AS ENUM ('JOURNEY_DEMAND', 'TRAFFIC', 'ORIGIN', 'DESTINATION');

-- CreateEnum
CREATE TYPE "RidePoolOfferStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RidePoolRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('JOURNEY_REMINDER', 'MATCH_FOUND', 'JOURNEY_STATUS', 'TRAFFIC_ALERT', 'RIDE_POOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SavedPlaceLabel" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "center_latitude" DOUBLE PRECISION NOT NULL,
    "center_longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "icon" VARCHAR(64) NOT NULL,
    "routing_profile" "RoutingProfile" NOT NULL,
    "traffic_supported" BOOLEAN NOT NULL,
    "approximation_note" VARCHAR(255),
    "pooling_eligible" BOOLEAN NOT NULL DEFAULT false,
    "default_seats" SMALLINT NOT NULL DEFAULT 1,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL,
    "phone_e164" VARCHAR(20),
    "phone_country_code" VARCHAR(5),
    "email" VARCHAR(254),
    "password_hash" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "profile_image_path" VARCHAR(255),
    "preferred_city_id" UUID,
    "default_vehicle_type_id" UUID,
    "share_journeys_for_matching" BOOLEAN NOT NULL DEFAULT true,
    "show_first_name_to_matches" BOOLEAN NOT NULL DEFAULT true,
    "notify_journey_reminders" BOOLEAN NOT NULL DEFAULT true,
    "notify_matches" BOOLEAN NOT NULL DEFAULT true,
    "notify_status_updates" BOOLEAN NOT NULL DEFAULT true,
    "notify_traffic_alerts" BOOLEAN NOT NULL DEFAULT true,
    "location_consent_at" TIMESTAMPTZ(6),
    "profile_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "replaced_by_id" UUID,
    "device_id" VARCHAR(128),
    "device_name" VARCHAR(128),
    "platform" VARCHAR(16),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "rotated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(20) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'LOGIN',
    "code_hash" CHAR(64) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resend_available_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "ip_address" VARCHAR(64),
    "provider" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "platform" VARCHAR(16) NOT NULL DEFAULT 'android',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "nickname" VARCHAR(60),
    "make_model" VARCHAR(80),
    "color" VARCHAR(30),
    "seats" SMALLINT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journeys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "city_id" UUID,
    "vehicle_type_id" UUID NOT NULL,
    "user_vehicle_id" UUID,
    "status" "JourneyStatus" NOT NULL DEFAULT 'PLANNED',
    "purpose" "JourneyPurpose" NOT NULL DEFAULT 'COMMUTE',
    "departure_at" TIMESTAMPTZ(6) NOT NULL,
    "estimated_arrival_at" TIMESTAMPTZ(6),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "notes" VARCHAR(280),
    "idempotency_key" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(200),
    "expired_at" TIMESTAMPTZ(6),
    "matches_computed_at" TIMESTAMPTZ(6),
    "locations_purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journey_id" UUID NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(400),
    "place_id" VARCHAR(255),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journey_id" UUID NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    "alternative_index" SMALLINT NOT NULL DEFAULT 0,
    "provider" VARCHAR(32) NOT NULL,
    "routing_profile" "RoutingProfile" NOT NULL,
    "encoded_polyline" TEXT NOT NULL,
    "geom" geometry(LineString, 4326) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "static_duration_seconds" INTEGER,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journey_id" UUID NOT NULL,
    "matched_journey_id" UUID NOT NULL,
    "matched_user_id" UUID NOT NULL,
    "match_type" "MatchType" NOT NULL,
    "shared_distance_meters" INTEGER NOT NULL,
    "overlap_ratio_self" DOUBLE PRECISION NOT NULL,
    "overlap_ratio_other" DOUBLE PRECISION NOT NULL,
    "direction_similarity" DOUBLE PRECISION NOT NULL,
    "departure_diff_seconds" INTEGER NOT NULL,
    "convergence_time_diff_seconds" INTEGER NOT NULL,
    "pickup_distance_meters" INTEGER NOT NULL,
    "destination_distance_meters" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" "MatchConfidence" NOT NULL,
    "common_segment_polyline" TEXT,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "city_id" UUID,
    "cell_key" VARCHAR(64) NOT NULL,
    "center_latitude" DOUBLE PRECISION NOT NULL,
    "center_longitude" DOUBLE PRECISION NOT NULL,
    "geom" geometry(Polygon, 4326) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_route_segments" (
    "journey_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "journey_route_segments_pkey" PRIMARY KEY ("journey_id","segment_id")
);

-- CreateTable
CREATE TABLE "traffic_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journey_id" UUID,
    "route_key" VARCHAR(128) NOT NULL,
    "routing_profile" "RoutingProfile" NOT NULL,
    "departure_offset_minutes" SMALLINT NOT NULL,
    "requested_departure_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "TrafficEstimateStatus" NOT NULL,
    "duration_seconds" INTEGER,
    "static_duration_seconds" INTEGER,
    "distance_meters" INTEGER,
    "speed_intervals" JSONB,
    "provider" VARCHAR(32) NOT NULL,
    "error_code" VARCHAR(64),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotspot_aggregations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "city_id" UUID,
    "model" "HotspotModel" NOT NULL,
    "cell_key" VARCHAR(64) NOT NULL,
    "center_latitude" DOUBLE PRECISION NOT NULL,
    "center_longitude" DOUBLE PRECISION NOT NULL,
    "cell_size_meters" INTEGER NOT NULL,
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "bucket_minutes" INTEGER NOT NULL,
    "vehicle_type_code" VARCHAR(32) NOT NULL DEFAULT 'ALL',
    "journey_count" INTEGER NOT NULL DEFAULT 0,
    "distinct_users" INTEGER NOT NULL DEFAULT 0,
    "congestion_index" DOUBLE PRECISION,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotspot_aggregations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_pool_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journey_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "total_seats" SMALLINT NOT NULL,
    "available_seats" SMALLINT NOT NULL,
    "status" "RidePoolOfferStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(280),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ride_pool_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_pool_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "offer_id" UUID NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "requester_journey_id" UUID,
    "seats" SMALLINT NOT NULL DEFAULT 1,
    "status" "RidePoolRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" VARCHAR(280),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ride_pool_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_pool_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "offer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "seats" SMALLINT NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "ride_pool_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "dedupe_key" VARCHAR(160),
    "push_status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "read_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" "SavedPlaceLabel" NOT NULL DEFAULT 'OTHER',
    "name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(400),
    "place_id" VARCHAR(255),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "source_name" VARCHAR(200) NOT NULL,
    "source_latitude" DOUBLE PRECISION NOT NULL,
    "source_longitude" DOUBLE PRECISION NOT NULL,
    "source_place_id" VARCHAR(255),
    "destination_name" VARCHAR(200) NOT NULL,
    "destination_latitude" DOUBLE PRECISION NOT NULL,
    "destination_longitude" DOUBLE PRECISION NOT NULL,
    "destination_place_id" VARCHAR(255),
    "pickup_name" VARCHAR(200),
    "pickup_latitude" DOUBLE PRECISION,
    "pickup_longitude" DOUBLE PRECISION,
    "vehicle_type_id" UUID,
    "usual_departure_time" CHAR(5),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status_code" SMALLINT,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "actor_role" "UserRole",
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "ip_address" VARCHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_code_key" ON "cities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_code_key" ON "vehicle_types"("code");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_replaced_by_id_key" ON "user_sessions"("replaced_by_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions"("family_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "otp_verifications_phone_e164_created_at_idx" ON "otp_verifications"("phone_e164", "created_at");

-- CreateIndex
CREATE INDEX "otp_verifications_ip_address_created_at_idx" ON "otp_verifications"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "otp_verifications_expires_at_idx" ON "otp_verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- CreateIndex
CREATE INDEX "user_vehicles_user_id_idx" ON "user_vehicles"("user_id");

-- CreateIndex
CREATE INDEX "journeys_status_departure_at_idx" ON "journeys"("status", "departure_at");

-- CreateIndex
CREATE INDEX "journeys_user_id_status_departure_at_idx" ON "journeys"("user_id", "status", "departure_at");

-- CreateIndex
CREATE INDEX "journeys_city_id_departure_at_idx" ON "journeys"("city_id", "departure_at");

-- CreateIndex
CREATE INDEX "journeys_vehicle_type_id_idx" ON "journeys"("vehicle_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "journeys_user_id_idempotency_key_key" ON "journeys"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "journey_locations_journey_id_kind_key" ON "journey_locations"("journey_id", "kind");

-- CreateIndex
CREATE INDEX "journey_routes_journey_id_idx" ON "journey_routes"("journey_id");

-- CreateIndex
CREATE INDEX "journey_matches_matched_journey_id_idx" ON "journey_matches"("matched_journey_id");

-- CreateIndex
CREATE INDEX "journey_matches_journey_id_score_idx" ON "journey_matches"("journey_id", "score");

-- CreateIndex
CREATE UNIQUE INDEX "journey_matches_journey_id_matched_journey_id_key" ON "journey_matches"("journey_id", "matched_journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_segments_cell_key_key" ON "route_segments"("cell_key");

-- CreateIndex
CREATE INDEX "route_segments_city_id_idx" ON "route_segments"("city_id");

-- CreateIndex
CREATE INDEX "journey_route_segments_segment_id_idx" ON "journey_route_segments"("segment_id");

-- CreateIndex
CREATE INDEX "traffic_snapshots_route_key_fetched_at_idx" ON "traffic_snapshots"("route_key", "fetched_at");

-- CreateIndex
CREATE INDEX "traffic_snapshots_fetched_at_idx" ON "traffic_snapshots"("fetched_at");

-- CreateIndex
CREATE INDEX "hotspot_aggregations_city_id_model_bucket_start_idx" ON "hotspot_aggregations"("city_id", "model", "bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "hotspot_unique_cell_bucket" ON "hotspot_aggregations"("model", "cell_key", "bucket_start", "bucket_minutes", "vehicle_type_code");

-- CreateIndex
CREATE UNIQUE INDEX "ride_pool_offers_journey_id_key" ON "ride_pool_offers"("journey_id");

-- CreateIndex
CREATE INDEX "ride_pool_offers_status_idx" ON "ride_pool_offers"("status");

-- CreateIndex
CREATE INDEX "ride_pool_requests_offer_id_status_idx" ON "ride_pool_requests"("offer_id", "status");

-- CreateIndex
CREATE INDEX "ride_pool_requests_requester_user_id_idx" ON "ride_pool_requests"("requester_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ride_pool_members_request_id_key" ON "ride_pool_members"("request_id");

-- CreateIndex
CREATE INDEX "ride_pool_members_offer_id_idx" ON "ride_pool_members"("offer_id");

-- CreateIndex
CREATE INDEX "ride_pool_members_user_id_idx" ON "ride_pool_members"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "saved_places_user_id_idx" ON "saved_places"("user_id");

-- CreateIndex
CREATE INDEX "saved_routes_user_id_idx" ON "saved_routes"("user_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_scope_key_key" ON "idempotency_records"("user_id", "scope", "key");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_preferred_city_id_fkey" FOREIGN KEY ("preferred_city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_default_vehicle_type_id_fkey" FOREIGN KEY ("default_vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_vehicle_id_fkey" FOREIGN KEY ("user_vehicle_id") REFERENCES "user_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_locations" ADD CONSTRAINT "journey_locations_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_routes" ADD CONSTRAINT "journey_routes_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_matches" ADD CONSTRAINT "journey_matches_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_matches" ADD CONSTRAINT "journey_matches_matched_journey_id_fkey" FOREIGN KEY ("matched_journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_matches" ADD CONSTRAINT "journey_matches_matched_user_id_fkey" FOREIGN KEY ("matched_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_segments" ADD CONSTRAINT "route_segments_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_route_segments" ADD CONSTRAINT "journey_route_segments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_route_segments" ADD CONSTRAINT "journey_route_segments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "route_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_snapshots" ADD CONSTRAINT "traffic_snapshots_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotspot_aggregations" ADD CONSTRAINT "hotspot_aggregations_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_offers" ADD CONSTRAINT "ride_pool_offers_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_offers" ADD CONSTRAINT "ride_pool_offers_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_requests" ADD CONSTRAINT "ride_pool_requests_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "ride_pool_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_requests" ADD CONSTRAINT "ride_pool_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_requests" ADD CONSTRAINT "ride_pool_requests_requester_journey_id_fkey" FOREIGN KEY ("requester_journey_id") REFERENCES "journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_members" ADD CONSTRAINT "ride_pool_members_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "ride_pool_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_members" ADD CONSTRAINT "ride_pool_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_pool_members" ADD CONSTRAINT "ride_pool_members_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "ride_pool_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written additions: constructs Prisma cannot express in schema.prisma
-- ═══════════════════════════════════════════════════════════════════════════

-- Partial unique indexes ----------------------------------------------------
-- A phone number may belong to only one non-deleted account.
CREATE UNIQUE INDEX "users_phone_e164_active_key" ON "users" ("phone_e164") WHERE "deleted_at" IS NULL AND "phone_e164" IS NOT NULL;
CREATE UNIQUE INDEX "users_email_active_key" ON "users" (lower("email")) WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;
-- Exactly one selected route per journey.
CREATE UNIQUE INDEX "journey_routes_selected_key" ON "journey_routes" ("journey_id") WHERE "is_selected";
-- One open (pending/accepted) seat request per user per ride offer.
CREATE UNIQUE INDEX "ride_pool_requests_active_key" ON "ride_pool_requests" ("offer_id", "requester_user_id") WHERE "status" IN ('PENDING', 'ACCEPTED');
-- Only one default vehicle per user.
CREATE UNIQUE INDEX "user_vehicles_default_key" ON "user_vehicles" ("user_id") WHERE "is_default" AND "deleted_at" IS NULL;

-- Spatial indexes (GiST) ----------------------------------------------------
CREATE INDEX "journey_locations_geom_gix" ON "journey_locations" USING GIST ("geom");
CREATE INDEX "journey_locations_geog_gix" ON "journey_locations" USING GIST (("geom"::geography));
CREATE INDEX "journey_routes_geom_gix" ON "journey_routes" USING GIST ("geom");
CREATE INDEX "journey_routes_geog_gix" ON "journey_routes" USING GIST (("geom"::geography)) WHERE "is_selected";
CREATE INDEX "route_segments_geom_gix" ON "route_segments" USING GIST ("geom");
CREATE INDEX "saved_places_geom_gix" ON "saved_places" USING GIST ("geom");

-- CHECK constraints ---------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164_format_chk" CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_anonymised_chk" CHECK ("status" <> 'DELETED' OR ("deleted_at" IS NOT NULL AND "phone_e164" IS NULL));

ALTER TABLE "cities" ADD CONSTRAINT "cities_center_chk" CHECK ("center_latitude" BETWEEN -90 AND 90 AND "center_longitude" BETWEEN -180 AND 180 AND "radius_meters" > 0);

ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_attempts_chk" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts");

ALTER TABLE "journey_locations" ADD CONSTRAINT "journey_locations_coords_chk" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "journey_locations" ADD CONSTRAINT "journey_locations_geom_valid_chk" CHECK (ST_IsValid("geom") AND ST_SRID("geom") = 4326);

ALTER TABLE "journey_routes" ADD CONSTRAINT "journey_routes_metrics_chk" CHECK ("distance_meters" > 0 AND "duration_seconds" >= 0);
ALTER TABLE "journey_routes" ADD CONSTRAINT "journey_routes_geom_chk" CHECK (ST_NPoints("geom") >= 2 AND ST_SRID("geom") = 4326 AND ST_Length("geom"::geography) > 0);

ALTER TABLE "journeys" ADD CONSTRAINT "journeys_version_chk" CHECK ("version" >= 1);
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_cancelled_chk" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_completed_chk" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL);

ALTER TABLE "journey_matches" ADD CONSTRAINT "journey_matches_not_self_chk" CHECK ("journey_id" <> "matched_journey_id");
ALTER TABLE "journey_matches" ADD CONSTRAINT "journey_matches_ratios_chk" CHECK (
  "overlap_ratio_self" BETWEEN 0 AND 1 AND "overlap_ratio_other" BETWEEN 0 AND 1
  AND "direction_similarity" BETWEEN -1 AND 1 AND "score" BETWEEN 0 AND 100 AND "shared_distance_meters" >= 0);

ALTER TABLE "hotspot_aggregations" ADD CONSTRAINT "hotspot_counts_chk" CHECK ("journey_count" >= 0 AND "distinct_users" >= 0 AND "bucket_minutes" > 0 AND ("congestion_index" IS NULL OR "congestion_index" BETWEEN 0 AND 1));

ALTER TABLE "ride_pool_offers" ADD CONSTRAINT "ride_pool_offers_seats_chk" CHECK ("total_seats" BETWEEN 1 AND 50 AND "available_seats" >= 0 AND "available_seats" <= "total_seats");
ALTER TABLE "ride_pool_requests" ADD CONSTRAINT "ride_pool_requests_seats_chk" CHECK ("seats" BETWEEN 1 AND 50);
ALTER TABLE "ride_pool_members" ADD CONSTRAINT "ride_pool_members_seats_chk" CHECK ("seats" BETWEEN 1 AND 50);

ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_coords_chk" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_time_chk" CHECK ("usual_departure_time" IS NULL OR "usual_departure_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_seats_chk" CHECK ("seats" IS NULL OR "seats" BETWEEN 1 AND 60);
