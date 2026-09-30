UPDATE team_invitation
SET status = 'REVOKED', consumed_at = CURRENT_TIMESTAMP(6)
WHERE status = 'PENDING' AND invitee_user_id IS NULL;

ALTER TABLE team_invitation DROP CHECK chk_team_invitation_target;
ALTER TABLE team_invitation
    ADD CONSTRAINT chk_team_invitation_target CHECK (status <> 'PENDING' OR invitee_user_id IS NOT NULL);
