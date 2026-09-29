CREATE TABLE team (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL,
    join_policy VARCHAR(20) NOT NULL DEFAULT 'REQUEST',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT chk_team_policy CHECK (join_policy IN ('REQUEST', 'INVITE_ONLY')),
    CONSTRAINT chk_team_status CHECK (status IN ('ACTIVE', 'DELETED'))
);

CREATE TABLE team_member (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    role VARCHAR(10) NOT NULL,
    status VARCHAR(10) NOT NULL,
    joined_at DATETIME(6) NOT NULL,
    removed_at DATETIME(6) NULL,
    active_owner_team_id BIGINT GENERATED ALWAYS AS
        (CASE WHEN role = 'OWNER' AND status = 'ACTIVE' THEN team_id ELSE NULL END) STORED,
    CONSTRAINT fk_team_member_team FOREIGN KEY (team_id) REFERENCES team(id),
    CONSTRAINT fk_team_member_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT uk_team_member_user UNIQUE (team_id, user_id),
    CONSTRAINT uk_team_active_owner UNIQUE (active_owner_team_id),
    CONSTRAINT chk_team_member_role CHECK (role IN ('OWNER', 'MEMBER')),
    CONSTRAINT chk_team_member_status CHECK (status IN ('ACTIVE', 'REMOVED'))
);
CREATE INDEX idx_team_member_user_status ON team_member(user_id, status, team_id);

CREATE TABLE team_invitation (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id BIGINT NOT NULL,
    email_normalized VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(12) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    CONSTRAINT fk_team_invitation_team FOREIGN KEY (team_id) REFERENCES team(id),
    CONSTRAINT uk_team_invitation_hash UNIQUE (token_hash),
    CONSTRAINT chk_team_invitation_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED'))
);
CREATE INDEX idx_team_invitation_team ON team_invitation(team_id, status);

CREATE TABLE team_join_request (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    status VARCHAR(12) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    resolved_at DATETIME(6) NULL,
    CONSTRAINT fk_team_join_request_team FOREIGN KEY (team_id) REFERENCES team(id),
    CONSTRAINT fk_team_join_request_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT uk_team_join_request_user UNIQUE (team_id, user_id),
    CONSTRAINT chk_team_join_request_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
);
CREATE INDEX idx_team_join_request_team ON team_join_request(team_id, status);

ALTER TABLE project
    ADD COLUMN team_id BIGINT NULL,
    ADD COLUMN created_by BIGINT NULL,
    ADD COLUMN legacy_unowned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT fk_project_team FOREIGN KEY (team_id) REFERENCES team(id),
    ADD CONSTRAINT fk_project_creator FOREIGN KEY (created_by) REFERENCES app_user(id);
CREATE INDEX idx_project_team_status_updated ON project(team_id, status, updated_at);
UPDATE project SET legacy_unowned = TRUE WHERE team_id IS NULL;
