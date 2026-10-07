package com.webeditor.collaboration;

import com.webeditor.project.repository.ProjectRepository;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class CollabPersistenceService {
    private final CollabStore store;
    private final CollabObjectStorage storage;
    private final ProjectRepository projects;
    private final TransactionTemplate tx;
    private final CollabMaintenanceMode maintenance;
    private final CollabMetrics metrics;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param store 协作指针及对象保护记录仓储
     * @param storage 对象存储接口
     * @param projects 项目仓储
     * @param tx 事务执行模板
     */
    public CollabPersistenceService(CollabStore store, CollabObjectStorage storage, ProjectRepository projects, TransactionTemplate tx,
            CollabMaintenanceMode maintenance, CollabMetrics metrics) {
        this.store = store; this.storage = storage; this.projects = projects; this.tx = tx;
        this.maintenance = maintenance; this.metrics = metrics;
    }
    /**
     * 确认项目为有效的团队协作项目后读取当前指针；缺失指针视为存储损坏。
     *
     * @param id 项目 ID
     * @return 当前有效协作项目的文档指针
     */
    public CollabPointer describe(long id) {
        var project = projects.findByIdAndStatus(id, (byte) 1).filter(p -> p.getTeamId() != null && !p.isLegacyUnowned())
                .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
        return store.find(project.getId()).orElseThrow(CollabFailure::corrupt);
    }
    /**
     * 核对 epoch、generation、对象键、类型、长度和 SHA-256，再返回完整文档二进制。
     *
     * @param id 项目 ID
     * @param epoch 文档生命周期编号
     * @param generation 文档持久化代次
     * @return 经过长度及摘要核对的文档二进制
     */
    public byte[] load(long id, long epoch, long generation) {
        CollabPointer p = describe(id); expected(p, epoch, generation);
        if (!p.objectKey().equals(CollabPointer.key(id, epoch, generation, p.contentHash())) || !p.contentType().equals(CollabPointer.CONTENT_TYPE)) throw CollabFailure.corrupt();
        byte[] bytes = storage.get(p.objectKey());
        if (bytes.length != p.size() || !hash(bytes).equals(p.contentHash())) throw CollabFailure.corrupt();
        return bytes;
    }
    /**
     * 先检查幂等回执，再取得上传租约并写入对象；事务内通过 CAS 推进 generation 并记录回执。相同请求重试返回原回执。
     *
     * @param id 项目 ID
     * @param epoch 文档生命周期编号
     * @param generation 调用方预期的当前持久化代次
     * @param key 本次保存的幂等键
     * @param bytes 文档二进制内容
     * @return 本次提交的新指针，或相同幂等请求之前生成的回执指针
     */
    public CollabPointer persist(long id, long epoch, long generation, String key, byte[] bytes) {
        maintenance.writable(); store.requireRecovered(id);
        long started = System.nanoTime();
        try {
            var saved = persistCurrent(id, epoch, generation, key, bytes);
            metrics.increment(CollabMetrics.Name.PERSIST_SUCCESS); return saved;
        } catch (RuntimeException failure) {
            metrics.increment(CollabMetrics.Name.PERSIST_FAILURE);
            if (failure instanceof CollabFailure c && "COLLAB_GENERATION_CONFLICT".equals(c.code())) metrics.increment(CollabMetrics.Name.CAS_CONFLICT);
            throw failure;
        } finally { metrics.add(CollabMetrics.Name.PERSIST_NANOS, System.nanoTime() - started); }
    }
    private CollabPointer persistCurrent(long id, long epoch, long generation, String key, byte[] bytes) {
        validateBytes(bytes);
        if (key == null || !key.matches("[A-Za-z0-9_-]{1,100}") || epoch < 1 || generation < 1 || generation == Long.MAX_VALUE)
            throw new CollabFailure(400, "COLLAB_INVALID_REQUEST");
        String hash = hash(bytes);
        // Receipt check happens before upload; it remains valid even after later successful saves.
        CollabPointer replay = tx.execute(status -> {
            lockProject(id);
            CollabPointer p = describe(id);
            if (p.epoch() != epoch) throw new CollabFailure(409, "COLLAB_EPOCH_CONFLICT");
            var receipt = store.receipt(id, key, epoch, generation, hash);
            if (receipt.isPresent()) return receipt.get();
            expected(p, epoch, generation); return null;
        });
        if (replay != null) return replay;
        CollabPointer next = new CollabPointer(id, epoch, generation + 1, CollabPointer.key(id, epoch, generation + 1, hash), hash, bytes.length, CollabPointer.CONTENT_TYPE);
        tx.executeWithoutResult(status -> store.lease(next.objectKey()));
        storage.put(next.objectKey(), bytes);
        return tx.execute(status -> {
            lockProject(id);
            CollabPointer current = describe(id);
            if (current.epoch() != epoch) throw new CollabFailure(409, "COLLAB_EPOCH_CONFLICT");
            var receipt = store.receipt(id, key, epoch, generation, hash);
            if (receipt.isPresent()) return receipt.get();
            store.requireLease(next.objectKey());
            if (!store.cas(next, generation)) throw new CollabFailure(409, "COLLAB_GENERATION_CONFLICT");
            store.receipt(key, generation, next); return next;
        });
    }
    /**
     * 以悲观写锁读取有效团队项目，串行化文档指针提交。
     *
     * @param id 项目 ID
     */
    private void lockProject(long id) {
        store.requireRecovered(id);
        projects.findActiveByIdForUpdate(id).filter(p -> p.getTeamId() != null && !p.isLegacyUnowned())
                .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
    }
    /**
     * 核对调用方预期的 epoch 和 generation，不匹配时抛出对应的 409 冲突。
     *
     * @param p 协作文档指针
     * @param epoch 文档生命周期编号
     * @param generation 文档持久化代次
     */
    public static void expected(CollabPointer p, long epoch, long generation) {
        if (p.epoch() != epoch) throw new CollabFailure(409, "COLLAB_EPOCH_CONFLICT");
        if (p.generation() != generation) throw new CollabFailure(409, "COLLAB_GENERATION_CONFLICT");
    }
    /**
     * 拒绝空文档及超过二进制大小上限的文档。
     *
     * @param bytes 文档二进制内容
     */
    public static void validateBytes(byte[] bytes) {
        if (bytes.length == 0 || bytes.length > CollabPointer.MAX_BYTES) throw new CollabFailure(413, "COLLAB_DOCUMENT_TOO_LARGE");
    }
    /**
     * 计算二进制内容的 SHA-256，返回小写十六进制摘要。
     *
     * @param bytes 文档二进制内容
     */
    public static String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
