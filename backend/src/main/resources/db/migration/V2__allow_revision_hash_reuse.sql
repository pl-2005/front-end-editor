ALTER TABLE project_revision DROP INDEX uk_revision_project_hash;
CREATE INDEX idx_revision_project_hash ON project_revision (project_id, content_hash);
