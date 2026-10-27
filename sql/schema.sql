-- Run this once in the Neon SQL Editor before connecting the app.
CREATE TABLE IF NOT EXISTS collection_app_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_app_state_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object')
);
