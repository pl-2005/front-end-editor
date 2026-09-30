package com.webeditor.team.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name = "team_invitation")
public class TeamInvitation {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "team_id", nullable = false) private long teamId;
    @Column(name = "email_normalized", length = 254) private String emailNormalized;
    @Column(name = "invitee_user_id") private Long inviteeUserId;
    @Column(nullable = false, length = 12) private String status = "PENDING";
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "created_at", nullable = false) private Instant createdAt = Instant.now();
    @Column(name = "consumed_at") private Instant consumedAt;
    protected TeamInvitation() {}
    public TeamInvitation(long teamId, long inviteeUserId, String emailNormalized, Instant expiresAt) {
        this.teamId = teamId; this.inviteeUserId = inviteeUserId; this.emailNormalized = emailNormalized; this.expiresAt = expiresAt;
    }
    public void consume() { status = "ACCEPTED"; consumedAt = Instant.now(); }
    public void reject() { status = "REJECTED"; consumedAt = Instant.now(); }
    public void revoke() { status = "REVOKED"; consumedAt = Instant.now(); }
    public boolean usable() { return "PENDING".equals(status) && Instant.now().isBefore(expiresAt); }
    public Long getId() { return id; }
    public long getTeamId() { return teamId; }
    public String getEmailNormalized() { return emailNormalized; }
    public Long getInviteeUserId() { return inviteeUserId; }
    public String getStatus() { return status; }
    public Instant getExpiresAt() { return expiresAt; }
}
