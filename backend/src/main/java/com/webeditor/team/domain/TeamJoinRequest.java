package com.webeditor.team.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name = "team_join_request", uniqueConstraints = @UniqueConstraint(name = "uk_team_join_request_user", columnNames = {"team_id", "user_id"}))
public class TeamJoinRequest {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "team_id", nullable = false) private long teamId;
    @Column(name = "user_id", nullable = false) private long userId;
    @Column(nullable = false, length = 12) private String status = "PENDING";
    @Column(name = "created_at", nullable = false) private Instant createdAt = Instant.now();
    @Column(name = "resolved_at") private Instant resolvedAt;
    protected TeamJoinRequest() {}
    public TeamJoinRequest(long teamId, long userId) { this.teamId = teamId; this.userId = userId; }
    public void reopen() { status = "PENDING"; createdAt = Instant.now(); resolvedAt = null; }
    public void resolve(String status) { this.status = status; resolvedAt = Instant.now(); }
    public Long getId() { return id; }
    public long getTeamId() { return teamId; }
    public long getUserId() { return userId; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
}
