-- Widen image_url to TEXT so base64 data URLs can be stored
ALTER TABLE banners ALTER COLUMN image_url TYPE TEXT;
