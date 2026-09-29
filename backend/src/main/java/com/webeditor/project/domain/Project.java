package com.webeditor.project.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

@Entity
@Table(name = "project")
public class Project {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(nullable = false, length = 30)
    private String template;

    @Column(name = "entry_file", nullable = false, length = 255)
    private String entryFile;

    @Column(name = "current_version", nullable = false)
    private int currentVersion;

    @Column(name = "current_object_key", length = 500)
    private String currentObjectKey;

    @Column(name = "team_id") private Long teamId;
    @Column(name = "created_by") private Long createdBy;
    @Column(name = "legacy_unowned", nullable = false) private boolean legacyUnowned;

    @Column(nullable = false)
    private byte status;

    @Version
    @Column(name = "lock_version", nullable = false)
    private long lockVersion;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Project() {
    }

    public Project(String name, String description, String template, String entryFile) {
        this.name = name;
        this.description = description;
        this.template = template;
        this.entryFile = entryFile;
        this.status = 1;
    }

    @PrePersist
    void beforeInsert() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void beforeUpdate() {
        updatedAt = Instant.now();
    }

    public void updateMetadata(String name, String description, String template) {
        this.name = name;
        this.description = description;
        this.template = template;
    }

    public void pointToSnapshot(int version, String objectKey, String entryFile) {
        this.currentVersion = version;
        this.currentObjectKey = objectKey;
        this.entryFile = entryFile;
    }

    public void delete() {
        status = 0;
    }

    public Long getId() { return id; }
    public Long getTeamId() { return teamId; }
    public Long getCreatedBy() { return createdBy; }
    public boolean isLegacyUnowned() { return legacyUnowned; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public String getTemplate() { return template; }
    public String getEntryFile() { return entryFile; }
    public int getCurrentVersion() { return currentVersion; }
    public String getCurrentObjectKey() { return currentObjectKey; }
    public byte getStatus() { return status; }
    public long getLockVersion() { return lockVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
