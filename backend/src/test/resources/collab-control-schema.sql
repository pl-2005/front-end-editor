CREATE TABLE IF NOT EXISTS collab_operation (
    id VARCHAR(36) NOT NULL PRIMARY KEY, project_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
    operation_type VARCHAR(20) NOT NULL, expected_lock_version BIGINT NOT NULL,
    expected_epoch BIGINT NOT NULL, expected_generation BIGINT NOT NULL, state VARCHAR(20) NOT NULL,
    fence_token VARCHAR(64), durable_generation BIGINT, durable_hash CHAR(64),
    lease_until DATETIME(6) NOT NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
    CHECK (operation_type IN ('DELETE', 'MAINTENANCE')), CHECK (state IN ('PREPARED', 'COMMITTED', 'ABORTED'))
);
CREATE TABLE IF NOT EXISTS collab_control_event (
    id VARCHAR(36) NOT NULL PRIMARY KEY, aggregate_id VARCHAR(100) NOT NULL,
    aggregate_sequence BIGINT NOT NULL, event_type VARCHAR(40) NOT NULL,
    project_id BIGINT, user_id BIGINT, team_id BIGINT, epoch BIGINT, authz_version BIGINT, operation_id VARCHAR(36),
    created_at DATETIME(6) NOT NULL, delivered_at DATETIME(6), acknowledged_at DATETIME(6),
    attempts INT NOT NULL DEFAULT 0, next_attempt_at DATETIME(6) NOT NULL,
    UNIQUE (aggregate_id, aggregate_sequence)
);
CREATE TABLE IF NOT EXISTS collab_recovery (
    project_id BIGINT NOT NULL PRIMARY KEY, operation_id VARCHAR(36) NOT NULL UNIQUE,
    expected_epoch BIGINT NOT NULL, expected_generation BIGINT NOT NULL, source_object_key VARCHAR(512) NOT NULL,
    state VARCHAR(20) NOT NULL, target_object_key VARCHAR(512), target_hash CHAR(64), target_size BIGINT,
    last_code VARCHAR(80), updated_at DATETIME(6) NOT NULL,
    CHECK (state IN ('PREPARED', 'FAILED', 'COMMITTED'))
);
