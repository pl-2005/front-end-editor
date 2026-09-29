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

    protected AppUser() {}
    public AppUser(String username, String normalizedUsername, String email, String normalizedEmail,
                   String passwordHash, String displayName, String avatarColor) {
        this.username = username; this.normalizedUsername = normalizedUsername; this.email = email;
        this.normalizedEmail = normalizedEmail; this.passwordHash = passwordHash;
        this.displayName = displayName; this.avatarColor = avatarColor;
    }
    @PrePersist void create() { createdAt = Instant.now(); updatedAt = createdAt; passwordChangedAt = createdAt; }
    @PreUpdate void update() { updatedAt = Instant.now(); }
    public void changePassword(String hash) { passwordHash = hash; passwordChangedAt = Instant.now(); revoke(); }
    public void revoke() { tokenVersion++; authzVersion++; }
    public void upgradeHash(String hash) { passwordHash = hash; }
    public Long getId() { return id; }
    public String getUsername() { return username; }
    public String getNormalizedUsername() { return normalizedUsername; }
    public String getEmail() { return email; }
    public String getNormalizedEmail() { return normalizedEmail; }
    public String getPasswordHash() { return passwordHash; }
    public String getDisplayName() { return displayName; }
    public String getAvatarColor() { return avatarColor; }
    public long getTokenVersion() { return tokenVersion; }
    public long getAuthzVersion() { return authzVersion; }
}
