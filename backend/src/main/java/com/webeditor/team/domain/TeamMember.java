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
    /**
     * 供 JPA 反射创建实体实例。
     */
    protected TeamMember() {}
    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param role 成员角色
     */
    public TeamMember(long teamId, long userId, String role) {
        this.teamId = teamId; this.userId = userId; this.role = role; this.joinedAt = Instant.now();
    }
    /**
     * 恢复成员关系为 ACTIVE 普通成员，重置加入时间并清除移除时间。
     */
    public void activate() { status = "ACTIVE"; role = "MEMBER"; joinedAt = Instant.now(); removedAt = null; }
    /**
     * 将成员关系标记为 REMOVED 并记录移除时间。
     */
    public void remove() { status = "REMOVED"; removedAt = Instant.now(); }
    /**
     * 设置成员角色，供团队所有权转移使用。
     *
     * @param role 成员角色
     */
    public void transferTo(String role) { this.role = role; }
    /**
     * 返回成员用户 ID。
     */
    public long getUserId() { return userId; }
    /**
     * 返回所属团队 ID。
     */
    public long getTeamId() { return teamId; }
    /**
     * 返回团队成员角色。
     */
    public String getRole() { return role; }
    /**
     * 返回当前状态。
     */
    public String getStatus() { return status; }
}
