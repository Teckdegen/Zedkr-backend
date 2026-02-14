-- ZedKr Database Schema for Supabase
-- Run this in your Supabase SQL Editor
--
-- IMPORTANT ARCHITECTURE NOTES:
-- 1. Backend NEVER directly communicates with Frontend
-- 2. Backend writes ALL data to Supabase (APIs, endpoints, API calls)
-- 3. Frontend reads ALL data from Supabase (no direct backend API calls for data)
-- 4. Only username is unique across all users
-- 5. API names and endpoint names can be duplicated across users
-- 6. Every API endpoint call is recorded in api_calls table
-- 7. Backend uses service role key (bypasses RLS)
-- 8. Frontend uses anon key (respects RLS policies)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
-- IMPORTANT: Only username is unique across all users
-- API names and endpoint names can be duplicated across different users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE, -- Only unique field across all users
  wallet_address VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for users
CREATE UNIQUE INDEX IF NOT EXISTS idx_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet ON users(wallet_address);

-- APIs table
-- NOTE: API names can be duplicated across users (e.g., "Weather API" can exist for 100M users)
-- Only the combination of (user_id, api_name_slug) must be unique per user
CREATE TABLE IF NOT EXISTS apis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_name VARCHAR(100) NOT NULL, -- Can be duplicated across users
  api_name_slug VARCHAR(100) NOT NULL, -- Can be duplicated across users
  image_url TEXT, -- Image URL for x402scan registration (optional)
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, api_name_slug) -- Only unique per user, not globally
);

-- Create indexes for APIs
CREATE INDEX IF NOT EXISTS idx_user_apis ON apis(user_id);
CREATE INDEX IF NOT EXISTS idx_api_slug ON apis(api_name_slug);

-- Endpoints table
-- NOTE: Endpoint names and paths can be duplicated across different APIs/users
-- Only the combination of (api_id, endpoint_path) must be unique per API
CREATE TABLE IF NOT EXISTS endpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_id UUID NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
  endpoint_name VARCHAR(200) NOT NULL, -- Can be duplicated across APIs/users
  endpoint_path VARCHAR(500) NOT NULL, -- Can be duplicated across APIs/users
  original_url TEXT NOT NULL, -- The actual API endpoint URL to proxy to
  monetized_url TEXT, -- The ZedKr monetized URL (e.g., https://zedkr.com/{username}/{apiName}/{endpointPath})
  price_microstx BIGINT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(api_id, endpoint_path), -- Only unique per API, not globally
  CHECK (endpoint_path ~ '^[a-z0-9_-]+$') -- Validate format: lowercase, alphanumeric, hyphens, underscores
);

-- Create indexes for endpoints
CREATE INDEX IF NOT EXISTS idx_api_endpoints ON endpoints(api_id);
CREATE INDEX IF NOT EXISTS idx_endpoint_path ON endpoints(endpoint_path);
CREATE INDEX IF NOT EXISTS idx_endpoint_active ON endpoints(active);

-- API calls table (logs)
-- This table records EVERY single API endpoint call
-- Backend writes here after payment verification and proxying
-- Frontend reads from here to display analytics per user
CREATE TABLE IF NOT EXISTS api_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  caller_wallet VARCHAR(100) NOT NULL, -- Wallet address of the caller
  tx_hash VARCHAR(100) UNIQUE NOT NULL, -- Transaction hash (prevents replay attacks)
  amount_paid BIGINT NOT NULL, -- Amount paid in microSTX
  status_code INT, -- HTTP status code from proxied request
  latency_ms INT, -- Request latency in milliseconds
  timestamp TIMESTAMP DEFAULT NOW() -- When the call was made
);

-- Create indexes for API calls
CREATE INDEX IF NOT EXISTS idx_endpoint_calls ON api_calls(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_tx_hash ON api_calls(tx_hash);
CREATE INDEX IF NOT EXISTS idx_timestamp ON api_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_caller_wallet ON api_calls(caller_wallet);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE apis ENABLE ROW LEVEL SECURITY;
ALTER TABLE endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_calls ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow service role to access everything)
-- Note: These policies allow full access via service role key
-- Frontend uses anon key with RLS, backend uses service role key (bypasses RLS)

-- Users: Allow service role full access
CREATE POLICY "Service role can manage users" ON users
  FOR ALL USING (true);

-- APIs: Allow service role full access
CREATE POLICY "Service role can manage apis" ON apis
  FOR ALL USING (true);

-- Endpoints: Allow service role full access
CREATE POLICY "Service role can manage endpoints" ON endpoints
  FOR ALL USING (true);

-- API calls: Allow service role full access
CREATE POLICY "Service role can manage api_calls" ON api_calls
  FOR ALL USING (true);

-- Frontend RLS Policies (for anon key access)
-- Since we use wallet-based auth (not Supabase auth), we can't use auth.uid()
-- Frontend filters by user_id/wallet_address, and RLS allows SELECT operations
-- The security comes from frontend filtering + application logic

-- Users: Allow public read (frontend filters by wallet_address)
-- In production, you might want to restrict this further
CREATE POLICY "Users can read user data" ON users
  FOR SELECT USING (true);

-- APIs: Allow public read (frontend filters by user_id)
-- Frontend ensures users only see their own APIs
CREATE POLICY "Users can read APIs" ON apis
  FOR SELECT USING (true);

-- Endpoints: Allow public read (frontend filters by api_id/user_id)
-- Frontend ensures users only see endpoints for their own APIs
CREATE POLICY "Users can read endpoints" ON endpoints
  FOR SELECT USING (true);

-- API calls: Allow public read (frontend filters by endpoint_id/user_id)
-- CRITICAL: Frontend MUST filter by user's endpoints only
-- This ensures users only see transactions for their own APIs
CREATE POLICY "Users can read API calls" ON api_calls
  FOR SELECT USING (true);

-- IMPORTANT SECURITY NOTE:
-- Since we use wallet-based auth (not Supabase auth), RLS can't use auth.uid()
-- Security is enforced at the application level:
-- 1. Frontend filters all queries by user_id/wallet_address
-- 2. Backend validates wallet address before writes
-- 3. All API call queries filter by user's endpoint IDs
--
-- For stronger security, consider:
-- 1. Using Supabase Auth with wallet addresses
-- 2. Creating database functions that check ownership
-- 3. Using PostgREST filters that enforce user_id matching

