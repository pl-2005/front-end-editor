CREATE TABLE collab_recovery (
    project_id BIGINT NOT NULL PRIMARY KEY,
    operation_id VARCHAR(36) NOT NULL UNIQUE,
    expected_epoch BIGINT NOT NULL,
    expected_generation BIGINT NOT NULL,
    source_object_key VARCHAR(512) NOT NULL,
    state VARCHAR(20) NOT NULL,
    target_object_key VARCHAR(512) NULL,
    target_hash CHAR(64) NULL,
    target_size BIGINT NULL,
    last_code VARCHAR(80) NULL,
    updated_at DATETIME(6) NOT NULL,
    CHECK (state IN ('PREPARED', 'FAILED', 'COMMITTED'))
);
