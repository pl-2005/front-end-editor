package com.webeditor.team.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name = "team_invitation")
public class TeamInvitation {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "team_id", nullable = false) private long teamId;
    @Column(name = "email_normalized", nullable = false, length = 254) private String emailNormalized;
    @Column(name = "token_hash", nullable = false, unique = true, columnDefinition = "char(64)") private String tokenHash;
    @Column(nullable = false, length = 12) private String status = "PENDING";
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "created_at", nullable = false) private Instant createdAt = Instant.now();
    @Column(name = "consumed_at") private Instant consumedAt;
    protected TeamInvitation() {}
    public TeamInvitation(long teamId, String emailNormalized, String tokenHash, Instant expiresAt) {
        this.teamId = teamId; this.emailNormalized = emailNormalized; this.tokenHash = tokenHash; this.expiresAt = expiresAt;
    }
    public void consume() { status = "ACCEPTED"; consumedAt = Instant.now(); }
    public void revoke() { status = "REVOKED"; consumedAt = Instant.now(); }
    public boolean usable() { return "PENDING".equals(status) && Instant.now().isBefore(expiresAt); }
    public Long getId() { return id; }
    public long getTeamId() { return teamId; }
    public String getEmailNormalized() { return emailNormalized; }
    public String getStatus() { return status; }
    public Instant getExpiresAt() { return expiresAt; }
}
