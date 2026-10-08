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
    /**
     * 供 JPA 反射创建实体实例。
     */
    protected Team() {}
    /**
     * 使用业务字段创建实体，时间和数据库 ID 由持久化流程补齐。
     *
     * @param name 名称
     * @param description 描述，允许为空
     */
    public Team(String name, String description) { this.name = name; this.description = description; }
    /**
     * 首次持久化时初始化团队创建时间和更新时间。
     */
    @PrePersist void create() { createdAt = Instant.now(); updatedAt = createdAt; }
    /**
     * 团队更新前刷新更新时间。
     */
    @PreUpdate void update() { updatedAt = Instant.now(); }
    /**
     * 设置团队加入策略；合法值由业务服务负责校验。
     *
     * @param policy 加入策略
     */
    public void setJoinPolicy(String policy) { joinPolicy = policy; }
    /** 更新名称及描述，输入规范化由业务服务负责。 */
    public void updateMetadata(String name, String description) {
        this.name = name;
        this.description = description;
    }
    /**
     * 返回记录 ID。
     */
    public Long getId() { return id; }
    /**
     * 返回名称。
     */
    public String getName() { return name; }
    /**
     * 返回描述。
     */
    public String getDescription() { return description; }
    /**
     * 返回团队加入策略。
     */
    public String getJoinPolicy() { return joinPolicy; }
    /**
     * 返回当前状态。
     */
    public String getStatus() { return status; }
    /**
     * 返回创建时间。
     */
    public Instant getCreatedAt() { return createdAt; }
}
