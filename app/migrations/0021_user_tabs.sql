-- Which tabs of the portal each person may open, chosen by an admin on the People page (shared/tabs.js).
-- NULL: every tab (everyone already here keeps what they had); else a JSON list of tab keys. Admins always see every tab.
ALTER TABLE users ADD COLUMN tabs TEXT;
