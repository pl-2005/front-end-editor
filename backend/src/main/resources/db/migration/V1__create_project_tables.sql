CREATE TABLE project (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL,
    template VARCHAR(30) NOT NULL DEFAULT 'vanilla',
    entry_file VARCHAR(255) NOT NULL DEFAULT '/index.html',
    current_version INT NOT NULL DEFAULT 0,
    current_object_key VARCHAR(500) NULL,
    status TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT chk_project_version CHECK (current_version >= 0),
    CONSTRAINT chk_project_status CHECK (status IN (0, 1))
);

CREATE TABLE project_revision (
    id BIGINT NOT NULL AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    version INT NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    content_hash CHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_revision_project FOREIGN KEY (project_id) REFERENCES project (id),
    CONSTRAINT uk_revision_project_version UNIQUE (project_id, version),
    CONSTRAINT uk_revision_project_hash UNIQUE (project_id, content_hash),
    CONSTRAINT chk_revision_version CHECK (version > 0),
    CONSTRAINT chk_revision_size CHECK (size_bytes >= 0)
);

CREATE INDEX idx_revision_project_created ON project_revision (project_id, created_at);

