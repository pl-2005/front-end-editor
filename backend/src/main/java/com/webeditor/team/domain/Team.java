package com.webeditor.team.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "team")
public class Team {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, length = 100) private String name;
    @Column(length = 500) private String description;
    @Column(name = "join_policy", nullable = false, length = 20) private String joinPolicy = "REQUEST";
    @Column(nullable = false, length = 20) private String status = "ACTIVE";
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    protected Team() {}
    public Team(String name, String description) { this.name = name; this.description = description; }
    @PrePersist void create() { createdAt = Instant.now(); updatedAt = createdAt; }
    @PreUpdate void update() { updatedAt = Instant.now(); }
    public void setJoinPolicy(String policy) { joinPolicy = policy; }
    public Long getId() { return id; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public String getJoinPolicy() { return joinPolicy; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
}
