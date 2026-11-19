-- The completeness report's Rule 1A, "No fetch data" and student names, worked out by Compute in the browser and stored
-- as sent (shared/completeness-core.js arrivalPart). Opening the report reads this instead of every mark, student and course.
ALTER TABLE runs ADD COLUMN arrival TEXT;
