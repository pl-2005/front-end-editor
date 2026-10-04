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
    /**
     * 供 JPA 反射创建实体实例。
     */
    protected TeamJoinRequest() {}
    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    public TeamJoinRequest(long teamId, long userId) { this.teamId = teamId; this.userId = userId; }
    /**
     * 重新开启已处理申请，重置创建时间并清除处理时间。
     */
    public void reopen() { status = "PENDING"; createdAt = Instant.now(); resolvedAt = null; }
    /**
     * 设置申请处理状态并记录处理时间。
     *
     * @param status 目标业务状态
     */
    public void resolve(String status) { this.status = status; resolvedAt = Instant.now(); }
    /**
     * 返回记录 ID。
     */
    public Long getId() { return id; }
    /**
     * 返回所属团队 ID。
     */
    public long getTeamId() { return teamId; }
    /**
     * 返回成员用户 ID。
     */
    public long getUserId() { return userId; }
    /**
     * 返回当前状态。
     */
    public String getStatus() { return status; }
    /**
     * 返回创建时间。
     */
    public Instant getCreatedAt() { return createdAt; }
}
