CREATE TABLE collab_ticket (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    team_id BIGINT NOT NULL,
    epoch BIGINT NOT NULL,
    authz_version BIGINT NOT NULL,
    issued_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id),
    FOREIGN KEY (project_id) REFERENCES project(id),
    FOREIGN KEY (team_id) REFERENCES team(id)
);
CREATE INDEX idx_collab_ticket_expiry ON collab_ticket(expires_at);
CREATE TABLE collab_hmac_nonce (
    audience VARCHAR(32) NOT NULL,
    nonce VARCHAR(36) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    PRIMARY KEY (audience, nonce)
);
CREATE INDEX idx_collab_nonce_expiry ON collab_hmac_nonce(expires_at);
