package com.webeditor.collaboration;

import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class CollabOrphanCleaner {
    private final CollabObjectStorage storage;
    private final CollabStore store;
    private final TransactionTemplate tx;
    private final Duration recoveryWindow, confirmationWindow;
    private final CollabMetrics metrics;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param storage 对象存储接口
     * @param store 协作指针及对象保护记录仓储
     * @param tx 事务执行模板
     * @param recoveryWindow 协作文档恢复保护时长
     * @param confirmationWindow 孤儿对象再次确认前的保护时长
     */
    @org.springframework.beans.factory.annotation.Autowired
    public CollabOrphanCleaner(CollabObjectStorage storage, CollabStore store, TransactionTemplate tx,
            @Value("${editor.collaboration.cleanup.recovery-window:30d}") Duration recoveryWindow,
            @Value("${editor.collaboration.cleanup.confirmation-window:24h}") Duration confirmationWindow, CollabMetrics metrics) {
        this.storage = storage; this.store = store; this.tx = tx;
        this.metrics = metrics;
        if (recoveryWindow.isNegative() || recoveryWindow.isZero() || confirmationWindow.isNegative() || confirmationWindow.isZero()
                || recoveryWindow.compareTo(Duration.ofDays(3650)) > 0 || confirmationWindow.compareTo(Duration.ofDays(3650)) > 0)
            throw new IllegalArgumentException("Cleanup windows must be positive and at most 3650 days");
        this.recoveryWindow = recoveryWindow; this.confirmationWindow = confirmationWindow;
    }
    public CollabOrphanCleaner(CollabObjectStorage storage, CollabStore store, TransactionTemplate tx,
            Duration recoveryWindow, Duration confirmationWindow) {
        this(storage, store, tx, recoveryWindow, confirmationWindow, new CollabMetrics());
    }
    /**
     * 使用当前时间执行定时协作文档孤儿清理。
     */
    @Scheduled(cron = "${editor.collaboration.cleanup.cron:0 0 4 * * *}")
    public void clean() { cleanAt(Instant.now()); }
    /**
     * 筛选超过恢复窗口的协作对象，经事务内二次确认取得删除资格后删除并登记完成。
     *
     * @param now 本次检查使用的时间
     */
    public void cleanAt(Instant now) {
        java.util.List<CollabObjectStorage.ObjectInfo> objects;
        try { objects = storage.list(); }
        catch (RuntimeException failure) { metrics.increment(CollabMetrics.Name.CLEANUP_FAILURE); return; }
        for (var object : objects) {
            if (!object.key().matches("collab/projects/[1-9][0-9]*/epochs/[1-9][0-9]*/[1-9][0-9]*-[a-f0-9]{64}\\.yjs")
                    || object.modifiedAt().isAfter(now.minus(recoveryWindow))) continue;
            Duration protection = recoveryWindow.compareTo(confirmationWindow) > 0 ? recoveryWindow : confirmationWindow;
            try {
                if (Boolean.TRUE.equals(tx.execute(status -> store.claimDeletion(object.key(), now, protection)))) {
                    storage.delete(object.key());
                    tx.executeWithoutResult(status -> store.deleted(object.key()));
                    metrics.increment(CollabMetrics.Name.CLEANUP_DELETED);
                }
            } catch (RuntimeException failure) { metrics.increment(CollabMetrics.Name.CLEANUP_FAILURE); }
        }
    }
}
