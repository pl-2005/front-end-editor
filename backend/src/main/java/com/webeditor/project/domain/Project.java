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
    @Column(name = "initialization_source_id") private Long initializationSourceId;

    @Column(nullable = false)
    private byte status;

    @Version
    @Column(name = "lock_version", nullable = false)
    private long lockVersion;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 供 JPA 反射创建实体实例。
     */
    protected Project() {
    }

    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param name 名称
     * @param description 描述，允许为空
     * @param template 项目模板标识
     * @param entryFile 入口文件绝对路径
     */
    public Project(String name, String description, String template, String entryFile) {
        this.name = name;
        this.description = description;
        this.template = template;
        this.entryFile = entryFile;
        this.status = 1;
    }

    /**
     * 首次持久化项目前初始化创建时间和更新时间。
     */
    @PrePersist
    void beforeInsert() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    /**
     * 项目更新前刷新更新时间。
     */
    @PreUpdate
    void beforeUpdate() {
        updatedAt = Instant.now();
    }

    /**
     * 更新项目名称、描述和模板，不变更当前快照指针。
     *
     * @param name 名称
     * @param description 描述，允许为空
     * @param template 项目模板标识
     */
    public void updateMetadata(String name, String description, String template) {
        this.name = name;
        this.description = description;
        this.template = template;
    }

    /**
     * 同时更新当前快照版本、对象键和入口文件，供快照事务提交。
     *
     * @param version 版本号
     * @param objectKey 存储对象键
     * @param entryFile 入口文件绝对路径
     */
    public void pointToSnapshot(int version, String objectKey, String entryFile) {
        this.currentVersion = version;
        this.currentObjectKey = objectKey;
        this.entryFile = entryFile;
    }

    /**
     * 将项目状态设为 0，执行软删除。
     */
    public void delete() {
        status = 0;
    }

    /**
     * 创建绑定团队和创建人的待初始化项目，状态为 2 且不属于遗留无主项目。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param name 名称
     * @param description 描述，允许为空
     * @param template 项目模板标识
     * @param entry 入口文件绝对路径
     */
    public static Project initializing(long teamId, long userId, String name, String description, String template, String entry) {
        Project p = new Project(name, description, template, entry);
        p.teamId = teamId; p.createdBy = userId; p.legacyUnowned = false; p.status = 2;
        return p;
    }
    /**
     * 将项目状态设为 1，使初始化完成的项目可见。
     */
    public void activate() { status = 1; }
    /**
     * 返回复制初始化的源项目 ID。
     */
    public Long getInitializationSourceId() { return initializationSourceId; }
    /**
     * 记录复制初始化的源项目 ID，供失败后重试读取源文档。
     *
     * @param id 复制初始化的源项目 ID
     */
    public void setInitializationSourceId(Long id) { initializationSourceId = id; }

    /**
     * 返回记录 ID。
     */
    public Long getId() { return id; }
    /**
     * 返回所属团队 ID。
     */
    public Long getTeamId() { return teamId; }
    /**
     * 返回项目创建者 ID。
     */
    public Long getCreatedBy() { return createdBy; }
    /**
     * 判断项目是否属于尚未归属团队的遗留记录。
     */
    public boolean isLegacyUnowned() { return legacyUnowned; }
    /**
     * 返回名称。
     */
    public String getName() { return name; }
    /**
     * 返回描述。
     */
    public String getDescription() { return description; }
    /**
     * 返回模板标识。
     */
    public String getTemplate() { return template; }
    /**
     * 返回入口文件路径。
     */
    public String getEntryFile() { return entryFile; }
    /**
     * 返回当前快照版本号。
     */
    public int getCurrentVersion() { return currentVersion; }
    /**
     * 返回当前快照对象键。
     */
    public String getCurrentObjectKey() { return currentObjectKey; }
    /**
     * 返回当前状态。
     */
    public byte getStatus() { return status; }
    /**
     * 返回元数据乐观锁版本。
     */
    public long getLockVersion() { return lockVersion; }
    /**
     * 返回创建时间。
     */
    public Instant getCreatedAt() { return createdAt; }
    /**
     * 返回更新时间。
     */
    public Instant getUpdatedAt() { return updatedAt; }
}
