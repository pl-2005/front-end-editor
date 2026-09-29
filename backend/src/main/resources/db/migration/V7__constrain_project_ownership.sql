ALTER TABLE project
    ADD CONSTRAINT chk_project_ownership CHECK (
        (legacy_unowned = TRUE AND team_id IS NULL AND created_by IS NULL) OR
        (legacy_unowned = FALSE AND team_id IS NOT NULL AND created_by IS NOT NULL)
    );
