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
    /**
     * 供 JPA 反射创建实体实例。
     */
    protected TeamInvitation() {}
    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param teamId 团队 ID
     * @param inviteeUserId 受邀用户 ID
     * @param emailNormalized 受邀人规范化邮箱
     * @param expiresAt 邀请到期时间
     */
    public TeamInvitation(long teamId, long inviteeUserId, String emailNormalized, Instant expiresAt) {
        this.teamId = teamId; this.inviteeUserId = inviteeUserId; this.emailNormalized = emailNormalized; this.expiresAt = expiresAt;
    }
    /**
     * 将邀请标记为 ACCEPTED 并记录处理时间。
     */
    public void consume() { status = "ACCEPTED"; consumedAt = Instant.now(); }
    /**
     * 将邀请标记为 REJECTED 并记录处理时间。
     */
    public void reject() { status = "REJECTED"; consumedAt = Instant.now(); }
    /**
     * 将邀请标记为 REVOKED 并记录处理时间。
     */
    public void revoke() { status = "REVOKED"; consumedAt = Instant.now(); }
    /**
     * 判断邀请是否仍为 PENDING 且尚未过期。
     */
    public boolean usable() { return "PENDING".equals(status) && Instant.now().isBefore(expiresAt); }
    /**
     * 返回记录 ID。
     */
    public Long getId() { return id; }
    /**
     * 返回所属团队 ID。
     */
    public long getTeamId() { return teamId; }
    /**
     * 返回受邀人规范化邮箱。
     */
    public String getEmailNormalized() { return emailNormalized; }
    /**
     * 返回受邀用户 ID。
     */
    public Long getInviteeUserId() { return inviteeUserId; }
    /**
     * 返回当前状态。
     */
    public String getStatus() { return status; }
    /**
     * 返回邀请到期时间。
     */
    public Instant getExpiresAt() { return expiresAt; }
}
