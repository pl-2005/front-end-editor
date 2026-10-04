package com.webeditor.collaboration;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CollabStore {
    private final JdbcTemplate jdbc;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param jdbc JDBC 数据访问模板
     */
    public CollabStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    /**
     * 按项目 ID 查询当前协作文档指针，不存在时返回空 Optional。
     *
     * @param id 项目 ID
     */
    public Optional<CollabPointer> find(long id) {
        return jdbc.query("SELECT * FROM collab_document WHERE project_id=?", (rs, row) ->
                new CollabPointer(id, rs.getLong("epoch"), rs.getLong("generation"), rs.getString("object_key"),
                        rs.getString("content_hash"), rs.getLong("size"), rs.getString("content_type")), id).stream().findFirst();
    }
    /**
     * 登记项目的首个协作文档指针并初始化审计时间。
     *
     * @param p 协作文档指针
     */
    public void insert(CollabPointer p) {
        jdbc.update("INSERT INTO collab_document(project_id, collaboration_mode, epoch, generation, object_key, content_hash, size, content_type, lock_version, created_at, updated_at) VALUES (?, 'YJS', ?, ?, ?, ?, ?, ?, 0, ?, ?)",
                p.projectId(), p.epoch(), p.generation(), p.objectKey(), p.contentHash(), p.size(), p.contentType(), ts(Instant.now()), ts(Instant.now()));
    }
    /**
     * 仅在项目 epoch 和预期 generation 匹配时更新文档指针，返回是否成功更新一行。
     *
     * @param p 协作文档指针
     * @param expected 提交前预期的 generation
     * @return 是否成功更新恰好一行指针记录
     */
    public boolean cas(CollabPointer p, long expected) {
        return jdbc.update("UPDATE collab_document SET generation=?, object_key=?, content_hash=?, size=?, lock_version=lock_version+1, updated_at=? WHERE project_id=? AND epoch=? AND generation=?",
                p.generation(), p.objectKey(), p.contentHash(), p.size(), ts(Instant.now()), p.projectId(), p.epoch(), expected) == 1;
    }
    /**
     * 查找幂等回执并核对 epoch、预期 generation 及内容摘要；键被不同请求复用时抛出冲突。
     *
     * @param id 项目 ID
     * @param key 本次保存的幂等键
     * @param epoch 文档生命周期编号
     * @param generation 文档持久化代次
     * @param hash 内容 SHA-256 十六进制摘要
     * @return 已匹配的回执指针；没有回执时为 empty
     */
    public Optional<CollabPointer> receipt(long id, String key, long epoch, long generation, String hash) {
        return jdbc.query("SELECT * FROM collab_persist_receipt WHERE project_id=? AND idempotency_key=?", (rs, row) -> {
            if (rs.getLong("expected_epoch") != epoch || rs.getLong("expected_generation") != generation || !rs.getString("content_hash").equals(hash))
                throw new CollabFailure(409, "COLLAB_IDEMPOTENCY_CONFLICT");
            return new CollabPointer(id, epoch, rs.getLong("generation"), rs.getString("object_key"), hash, rs.getLong("size"), CollabPointer.CONTENT_TYPE);
        }, id, key).stream().findFirst();
    }
    /**
     * 记录本次保存的幂等键、预期 generation 和最终文档指针。
     *
     * @param key 本次保存的幂等键
     * @param expected 提交前预期的 generation
     * @param p 协作文档指针
     */
    public void receipt(String key, long expected, CollabPointer p) {
        jdbc.update("INSERT INTO collab_persist_receipt(project_id, idempotency_key, expected_epoch, expected_generation, generation, object_key, content_hash, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                p.projectId(), key, p.epoch(), expected, p.generation(), p.objectKey(), p.contentHash(), p.size(), ts(Instant.now()));
    }
    /**
     * 为对象创建 LIVE 状态的保护记录，已有记录保持原状态。
     *
     * @param key 协作文档存储对象键
     */
    public void ensureGuard(String key) {
        jdbc.update("INSERT INTO collab_object_guard(object_key, state, lease_until) VALUES (?, 'LIVE', ?) ON DUPLICATE KEY UPDATE object_key=object_key", key, ts(Instant.EPOCH));
    }
    /**
     * 锁定 LIVE 对象保护记录，授予十分钟上传租约并清除孤儿观察时间。
     *
     * @param key 协作文档存储对象键
     */
    public void lease(String key) {
        ensureGuard(key);
        String state = jdbc.queryForObject("SELECT state FROM collab_object_guard WHERE object_key=? FOR UPDATE", String.class, key);
        if (!"LIVE".equals(state)) throw new CollabFailure(409, "COLLAB_OBJECT_RETIRED");
        jdbc.update("UPDATE collab_object_guard SET lease_until=?, unreferenced_since=NULL WHERE object_key=?", ts(Instant.now().plus(Duration.ofMinutes(10))), key);
    }
    /**
     * 锁定对象保护记录，确认对象仍为 LIVE 且上传租约尚未到期。
     *
     * @param key 协作文档存储对象键
     */
    public void requireLease(String key) {
        Guard guard = lockGuard(key);
        if (!"LIVE".equals(guard.state()) || !guard.leaseUntil().isAfter(Instant.now()))
            throw new CollabFailure(409, "COLLAB_UPLOAD_LEASE_EXPIRED");
    }
    /**
     * 在对象保护锁内登记备份保留期限，拒绝已退役对象和无效保留时间。
     *
     * @param backupId 备份标识
     * @param key 协作文档存储对象键
     * @param retainUntil 备份保留截止时间
     */
    public void pinBackup(String backupId, String key, Instant retainUntil) {
        ensureGuard(key);
        String state = jdbc.queryForObject("SELECT state FROM collab_object_guard WHERE object_key=? FOR UPDATE", String.class, key);
        if (!"LIVE".equals(state)) throw new CollabFailure(409, "COLLAB_OBJECT_RETIRED");
        if (!retainUntil.isAfter(Instant.now())) throw new CollabFailure(400, "COLLAB_INVALID_BACKUP_WINDOW");
        jdbc.update("INSERT INTO collab_backup_reference(backup_id, object_key, retain_until) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE retain_until=?",
                backupId, key, ts(retainUntil), ts(retainUntil));
    }
    /**
     * 检查对象是否被当前文档或尚未到期的备份引用。
     *
     * @param key 协作文档存储对象键
     * @param now 本次检查使用的时间
     * @return 是否存在当前文档引用或有效备份引用
     */
    public boolean referenced(String key, Instant now) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM collab_document WHERE object_key=?", Long.class, key) > 0
                || jdbc.queryForObject("SELECT COUNT(*) FROM collab_backup_reference WHERE object_key=? AND retain_until>?", Long.class, key, ts(now)) > 0;
    }
    // First observation quarantines; a later pass rechecks under the same upload guard.
    /**
     * 在对象保护锁内排除引用和有效租约；首次仅登记孤儿观察时间，保护窗口过后才转为 DELETING。
     *
     * @param key 协作文档存储对象键
     * @param now 本次检查使用的时间
     * @param confirmationWindow 孤儿对象再次确认前的保护时长
     * @return 是否已通过再次确认并取得对象删除资格
     */
    public boolean claimDeletion(String key, Instant now, Duration confirmationWindow) {
        ensureGuard(key);
        Guard guard = lockGuard(key);
        if ("DELETED".equals(guard.state())) return false;
        if (referenced(key, now) || guard.leaseUntil().isAfter(now)) {
            jdbc.update("UPDATE collab_object_guard SET unreferenced_since=NULL WHERE object_key=?", key); return false;
        }
        Instant since = guard.unreferencedSince();
        if (since == null) {
            jdbc.update("UPDATE collab_object_guard SET unreferenced_since=? WHERE object_key=?", ts(now), key); return false;
        }
        if (since.plus(confirmationWindow).isAfter(now)) return false;
        jdbc.update("UPDATE collab_object_guard SET state='DELETING' WHERE object_key=?", key); return true;
    }
    /**
     * 将已取得删除资格的对象标记为 DELETED，阻止后续上传复用。
     *
     * @param key 协作文档存储对象键
     */
    public void deleted(String key) { jdbc.update("UPDATE collab_object_guard SET state='DELETED' WHERE object_key=? AND state='DELETING'", key); }
    private record Guard(String state, Instant leaseUntil, Instant unreferencedSince) {}
    /**
     * 以 FOR UPDATE 锁读取对象保护状态、租约和孤儿观察时间。
     *
     * @param key 协作文档存储对象键
     */
    private Guard lockGuard(String key) {
        return jdbc.queryForObject("SELECT state, lease_until, unreferenced_since FROM collab_object_guard WHERE object_key=? FOR UPDATE", (rs, row) -> {
            Timestamp since = rs.getTimestamp("unreferenced_since");
            return new Guard(rs.getString("state"), rs.getTimestamp("lease_until").toInstant(), since == null ? null : since.toInstant());
        }, key);
    }
    /**
     * 将 Instant 转换为 JDBC 使用的 Timestamp。
     *
     * @param value 待转换的时间
     */
    private static Timestamp ts(Instant value) { return Timestamp.from(value); }
}
