package com.webeditor.project.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "project_revision")
public class ProjectRevision {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(nullable = false)
    private int version;

    @Column(name = "object_key", nullable = false, length = 500)
    private String objectKey;

    @Column(name = "content_hash", nullable = false, columnDefinition = "char(64)")
    private String contentHash;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * 供 JPA 反射创建实体实例。
     */
    protected ProjectRevision() {
    }

    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param project 项目实体或摘要
     * @param version 版本号
     * @param objectKey 存储对象键
     * @param contentHash 内容摘要
     * @param sizeBytes 压缩快照的字节数
     */
    public ProjectRevision(Project project, int version, String objectKey, String contentHash, long sizeBytes) {
        this.project = project;
        this.version = version;
        this.objectKey = objectKey;
        this.contentHash = contentHash;
        this.sizeBytes = sizeBytes;
    }

    /**
     * 首次持久化修订记录前设置创建时间。
     */
    @PrePersist
    void beforeInsert() {
        createdAt = Instant.now();
    }

    /**
     * 返回快照修订版本号。
     */
    public int getVersion() { return version; }
    /**
     * 返回快照存储对象键。
     */
    public String getObjectKey() { return objectKey; }
    /**
     * 返回内容 SHA-256 摘要。
     */
    public String getContentHash() { return contentHash; }
    /**
     * 返回压缩快照字节数。
     */
    public long getSizeBytes() { return sizeBytes; }
    /**
     * 返回创建时间。
     */
    public Instant getCreatedAt() { return createdAt; }
}
