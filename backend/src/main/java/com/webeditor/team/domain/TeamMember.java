package com.webeditor.team.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "team_member", uniqueConstraints = @UniqueConstraint(name = "uk_team_member_user", columnNames = {"team_id", "user_id"}))
public class TeamMember {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "team_id", nullable = false) private long teamId;
    @Column(name = "user_id", nullable = false) private long userId;
    @Column(nullable = false, length = 10) private String role;
    @Column(nullable = false, length = 10) private String status = "ACTIVE";
    @Column(name = "joined_at", nullable = false) private Instant joinedAt;
    @Column(name = "removed_at") private Instant removedAt;
    protected TeamMember() {}
    public TeamMember(long teamId, long userId, String role) {
        this.teamId = teamId; this.userId = userId; this.role = role; this.joinedAt = Instant.now();
    }
    public void activate() { status = "ACTIVE"; role = "MEMBER"; joinedAt = Instant.now(); removedAt = null; }
    public void remove() { status = "REMOVED"; removedAt = Instant.now(); }
    public void transferTo(String role) { this.role = role; }
    public long getUserId() { return userId; }
    public long getTeamId() { return teamId; }
    public String getRole() { return role; }
    public String getStatus() { return status; }
}
