package com.webeditor.collaboration;

import com.webeditor.project.repository.ProjectRepository;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** A backup must capture MySQL metadata together with every pinned binary object. */
@Service
public class CollabBackupService {
    private final CollabStore store;
    private final ProjectRepository projects;
    private final TransactionTemplate tx;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param store 协作指针及对象保护记录仓储
     * @param projects 项目仓储
     * @param tx 事务执行模板
     */
    public CollabBackupService(CollabStore store, ProjectRepository projects, TransactionTemplate tx) {
        this.store = store; this.projects = projects; this.tx = tx;
    }
    /**
     * 在事务中锁定项目并为当前文档登记备份引用，返回需与数据库元数据一起备份的对象指针。
     *
     * @param id 项目 ID
     * @param backupId 备份标识
     * @param retainUntil 备份保留截止时间
     * @return 本次固定的文档指针，备份时须同时保留其二进制对象
     */
    public CollabPointer pinCurrent(long id, String backupId, Instant retainUntil) {
        if (backupId == null || !backupId.matches("[A-Za-z0-9_-]{1,100}") || retainUntil == null) throw new CollabFailure(400, "COLLAB_INVALID_BACKUP_ID");
        return tx.execute(status -> {
            projects.findByIdForUpdate(id).orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
            CollabPointer p = store.find(id).orElseThrow(CollabFailure::corrupt);
            store.pinBackup(backupId, p.objectKey(), retainUntil); return p;
        });
    }
}
