ALTER TABLE project DROP CHECK chk_project_status;
ALTER TABLE project ADD CONSTRAINT chk_project_status CHECK (status IN (0, 1, 2));
ALTER TABLE project ADD COLUMN initialization_source_id BIGINT NULL;

CREATE TABLE collab_document (
    project_id BIGINT NOT NULL PRIMARY KEY,
    collaboration_mode VARCHAR(20) NOT NULL DEFAULT 'YJS',
    epoch BIGINT NOT NULL,
    generation BIGINT NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    content_hash CHAR(64) NOT NULL,
    size BIGINT NOT NULL,
    content_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    lock_version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT fk_collab_project FOREIGN KEY (project_id) REFERENCES project(id),
    CONSTRAINT chk_collab_generation CHECK (epoch > 0 AND generation > 0),
    CONSTRAINT chk_collab_size CHECK (size > 0 AND size <= 12582912),
    CONSTRAINT chk_collab_mode CHECK (collaboration_mode = 'YJS'),
    CONSTRAINT chk_collab_type CHECK (content_type = 'application/octet-stream'),
    CONSTRAINT uk_collab_object UNIQUE (object_key)
);

-- Durable receipts survive response loss and subsequent pointer changes.
CREATE TABLE collab_persist_receipt (
    project_id BIGINT NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    expected_epoch BIGINT NOT NULL,
    expected_generation BIGINT NOT NULL,
    generation BIGINT NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    content_hash CHAR(64) NOT NULL,
    size BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (project_id, idempotency_key),
    CONSTRAINT fk_collab_receipt_project FOREIGN KEY (project_id) REFERENCES project(id)
);

-- Uploaders and cleaner coordinate through the same per-object row.
CREATE TABLE collab_object_guard (
    object_key VARCHAR(500) NOT NULL PRIMARY KEY,
    state VARCHAR(10) NOT NULL,
    lease_until DATETIME(6) NOT NULL,
    unreferenced_since DATETIME(6) NULL,
    CONSTRAINT chk_collab_guard_state CHECK (state IN ('LIVE', 'DELETING', 'DELETED'))
);
CREATE TABLE collab_backup_reference (
    backup_id VARCHAR(100) NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    retain_until DATETIME(6) NOT NULL,
    PRIMARY KEY (backup_id, object_key)
);
CREATE INDEX idx_collab_backup_object ON collab_backup_reference(object_key, retain_until);
