-- Sample checking: at generate the portal picks one pass and one fail student; the checking team checks those two.
ALTER TABLE grade_register_students ADD COLUMN outcome TEXT;   -- 'pass' / 'fail' / NULL (could not tell)
ALTER TABLE grade_register_students ADD COLUMN sample TEXT;    -- 'pass' / 'fail' when picked for checking
