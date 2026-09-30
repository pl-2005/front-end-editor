ALTER TABLE team_invitation
    ADD COLUMN invitee_user_id BIGINT NULL;

UPDATE team_invitation i
JOIN app_user u ON u.normalized_email = i.email_normalized
SET i.invitee_user_id = u.id
WHERE i.status = 'PENDING';

UPDATE team_invitation
SET status = 'REVOKED', consumed_at = CURRENT_TIMESTAMP(6)
WHERE status = 'PENDING' AND expires_at <= CURRENT_TIMESTAMP(6);

UPDATE team_invitation i
JOIN team_member m ON m.team_id = i.team_id AND m.user_id = i.invitee_user_id AND m.status = 'ACTIVE'
SET i.status = 'REVOKED', i.consumed_at = CURRENT_TIMESTAMP(6)
WHERE i.status = 'PENDING';

UPDATE team_invitation older
JOIN team_invitation newer ON newer.team_id = older.team_id
    AND newer.email_normalized = older.email_normalized
    AND newer.status = 'PENDING' AND newer.id > older.id
SET older.status = 'REVOKED', older.consumed_at = CURRENT_TIMESTAMP(6)
WHERE older.status = 'PENDING';

ALTER TABLE team_invitation
    MODIFY COLUMN email_normalized VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    DROP INDEX uk_team_invitation_hash,
    DROP COLUMN token_hash,
    ADD CONSTRAINT fk_team_invitation_invitee FOREIGN KEY (invitee_user_id) REFERENCES app_user(id);

ALTER TABLE team_invitation DROP CHECK chk_team_invitation_status;
ALTER TABLE team_invitation
    ADD CONSTRAINT chk_team_invitation_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED')),
    ADD CONSTRAINT chk_team_invitation_target CHECK (
        status <> 'PENDING' OR invitee_user_id IS NOT NULL OR email_normalized IS NOT NULL
    ),
    ADD COLUMN pending_invitee_user_id BIGINT GENERATED ALWAYS AS
        (CASE WHEN status = 'PENDING' THEN invitee_user_id ELSE NULL END) STORED,
    ADD COLUMN pending_email_normalized VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin
        GENERATED ALWAYS AS (CASE WHEN status = 'PENDING' THEN email_normalized ELSE NULL END) STORED,
    ADD CONSTRAINT uk_team_invitation_pending_user UNIQUE (team_id, pending_invitee_user_id),
    ADD CONSTRAINT uk_team_invitation_pending_email UNIQUE (team_id, pending_email_normalized);

CREATE INDEX idx_team_invitation_recipient ON team_invitation(invitee_user_id, status, expires_at);
