package com.webeditor.identity.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "app_user")
public class AppUser {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, length = 50) private String username;
    @Column(name = "normalized_username", nullable = false, length = 50) private String normalizedUsername;
    @Column(length = 254) private String email;
    @Column(name = "normalized_email", length = 254) private String normalizedEmail;
    @Column(name = "password_hash", nullable = false) private String passwordHash;
    @Column(name = "display_name", nullable = false, length = 100) private String displayName;
    @Column(name = "avatar_color", nullable = false, columnDefinition = "char(7)") private String avatarColor;
    @Column(name = "authz_version", nullable = false) private long authzVersion;
    @Column(name = "token_version", nullable = false) private long tokenVersion;
    @Column(name = "password_changed_at", nullable = false) private Instant passwordChangedAt;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    /**
     * 供 JPA 反射创建实体实例。
     */
    protected AppUser() {}
    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param username 用户名
     * @param normalizedUsername 规范化用户名
     * @param email 邮箱
     * @param normalizedEmail 规范化邮箱
     * @param passwordHash 已编码的密码摘要
     * @param displayName 显示名称
     * @param avatarColor 头像颜色
     */
    public AppUser(String username, String normalizedUsername, String email, String normalizedEmail,
                   String passwordHash, String displayName, String avatarColor) {
        this.username = username; this.normalizedUsername = normalizedUsername; this.email = email;
        this.normalizedEmail = normalizedEmail; this.passwordHash = passwordHash;
        this.displayName = displayName; this.avatarColor = avatarColor;
    }
    /**
     * 首次持久化时初始化创建、更新及密码变更时间。
     */
    @PrePersist void create() { createdAt = Instant.now(); updatedAt = createdAt; passwordChangedAt = createdAt; }
    /**
     * 实体更新前刷新更新时间。
     */
    @PreUpdate void update() { updatedAt = Instant.now(); }
    /**
     * 设置密码摘要和变更时间，并递增版本撤销既有凭据。
     *
     * @param hash 内容 SHA-256 十六进制摘要
     */
    public void changePassword(String hash) { passwordHash = hash; passwordChangedAt = Instant.now(); revoke(); }
    /**
     * 递增令牌版本和授权版本，使已有令牌及旧授权状态失效。
     */
    public void revoke() { tokenVersion++; authzVersion++; }
    /**
     * 仅替换密码摘要编码，保留密码变更时间及会话版本。
     *
     * @param hash 内容 SHA-256 十六进制摘要
     */
    public void upgradeHash(String hash) { passwordHash = hash; }
    /**
     * 返回记录 ID。
     */
    public Long getId() { return id; }
    /**
     * 返回用户名。
     */
    public String getUsername() { return username; }
    /**
     * 返回规范化用户名。
     */
    public String getNormalizedUsername() { return normalizedUsername; }
    /**
     * 返回邮箱。
     */
    public String getEmail() { return email; }
    /**
     * 返回规范化邮箱。
     */
    public String getNormalizedEmail() { return normalizedEmail; }
    /**
     * 返回密码摘要。
     */
    public String getPasswordHash() { return passwordHash; }
    /**
     * 返回显示名称。
     */
    public String getDisplayName() { return displayName; }
    /**
     * 返回头像颜色。
     */
    public String getAvatarColor() { return avatarColor; }
    /**
     * 返回用于撤销令牌的版本。
     */
    public long getTokenVersion() { return tokenVersion; }
    /**
     * 返回授权版本。
     */
    public long getAuthzVersion() { return authzVersion; }
}
