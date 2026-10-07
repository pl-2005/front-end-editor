package com.webeditor.project.application;

import com.webeditor.common.exception.ResourceNotFoundException;
import com.webeditor.common.exception.VersionConflictException;
import com.webeditor.common.exception.RevisionNotFoundException;
import com.webeditor.project.domain.Project;
import com.webeditor.project.domain.ProjectRevision;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.project.repository.ProjectRevisionRepository;
import com.webeditor.storage.SnapshotStorage;
import com.webeditor.storage.StorageException;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class SnapshotService {
    private static final Logger log = LoggerFactory.getLogger(SnapshotService.class);
    private final ProjectRepository projects;
    private final ProjectRevisionRepository revisions;
    private final SnapshotStorage storage;
    private final SnapshotCodec codec;
    private final SnapshotValidator validator;
    private final TransactionTemplate transactions;

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param projects 项目仓储
     * @param revisions 快照修订仓储
     * @param storage 对象存储接口
     * @param codec 快照编解码器
     * @param validator 快照校验器
     * @param transactions 事务执行模板
     */
    public SnapshotService(ProjectRepository projects, ProjectRevisionRepository revisions,
                           SnapshotStorage storage, SnapshotCodec codec, SnapshotValidator validator,
                           TransactionTemplate transactions) {
        this.projects = projects;
        this.revisions = revisions;
        this.storage = storage;
        this.codec = codec;
        this.validator = validator;
        this.transactions = transactions;
    }

    /**
     * 校验快照并锁定项目，检查预期版本；内容未变化时复用当前版本，否则上传对象并提交新修订。失败时尝试清理已上传对象。
     *
     * @param projectId 项目 ID
     * @param request 业务请求数据，字段约束见请求类型
     * @return 保存后的版本、状态版本、内容摘要和保存时间；内容未变时返回当前修订信息
     */
    public ProjectResponses.SnapshotSaved save(long projectId, SaveSnapshotRequest request) {
        validator.validate(request.entry(), request.files());
        SnapshotCodec.EncodedSnapshot encoded = codec.encode(request.entry(), request.files());
        validator.validateEncodedSize(encoded.uncompressedBytes());
        AtomicReference<String> uploadedKey = new AtomicReference<>();

        try {
            return transactions.execute(status -> {
                Project project = projects.findActiveByIdForUpdate(projectId)
                        .orElseThrow(() -> new ResourceNotFoundException("项目不存在"));
                rejectCollaboration(project);
                if (project.getCurrentVersion() != request.expectedVersion()) {
                    throw new VersionConflictException("项目已被其他编辑会话更新，请重新加载后再保存");
                }

                if (project.getCurrentVersion() > 0) {
                    ProjectRevision current = revisions.findByProjectIdAndVersion(projectId,
                                    project.getCurrentVersion())
                            .orElseThrow(() -> new IllegalStateException("Current project revision is missing"));
                    if (current.getContentHash().equals(encoded.hash())) {
                        return new ProjectResponses.SnapshotSaved(current.getVersion(), project.getLockVersion(), current.getContentHash(),
                                current.getCreatedAt());
                    }
                }

                int nextVersion = project.getCurrentVersion() + 1;
                String objectKey = "projects/%d/revisions/%d-%s.json.gz"
                        .formatted(projectId, nextVersion, encoded.hash());
                storage.put(objectKey, encoded.compressed());
                uploadedKey.set(objectKey);

                ProjectRevision revision = revisions.save(new ProjectRevision(project, nextVersion, objectKey,
                        encoded.hash(), encoded.compressed().length));
                project.pointToSnapshot(nextVersion, objectKey, request.entry());
                projects.save(project);
                revisions.flush();
                projects.flush();
                return new ProjectResponses.SnapshotSaved(nextVersion, project.getLockVersion(), encoded.hash(), revision.getCreatedAt());
            });
        } catch (RuntimeException exception) {
            cleanupOrphan(uploadedKey.get(), exception);
            throw exception;
        }
    }

    /**
     * 锁定项目并检查预期版本，将历史快照复制为一个新版本而非回退版本号；失败时尝试清理上传对象。
     *
     * @param projectId 项目 ID
     * @param sourceVersion 待恢复的历史版本号
     * @param request 业务请求数据，字段约束见请求类型
     * @return 由历史快照创建的新修订信息
     */
    public ProjectResponses.SnapshotSaved restore(long projectId, int sourceVersion,
                                                   RestoreRevisionRequest request) {
        AtomicReference<String> uploadedKey = new AtomicReference<>();
        try {
            return transactions.execute(status -> {
                Project project = projects.findActiveByIdForUpdate(projectId)
                        .orElseThrow(() -> new ResourceNotFoundException("项目不存在"));
                rejectCollaboration(project);
                if (project.getCurrentVersion() != request.expectedVersion()) {
                    throw new VersionConflictException("项目已被其他编辑会话更新，请刷新版本列表后重试");
                }
                ProjectRevision source = revisions.findByProjectIdAndVersion(projectId, sourceVersion)
                        .orElseThrow(() -> new RevisionNotFoundException("项目版本不存在"));
                byte[] content = storage.get(source.getObjectKey());
                SnapshotDocument document = codec.decode(content);
                validator.validate(document.entry(), document.files());

                int nextVersion = project.getCurrentVersion() + 1;
                String objectKey = "projects/%d/revisions/%d-%s.json.gz"
                        .formatted(projectId, nextVersion, source.getContentHash());
                storage.put(objectKey, content);
                uploadedKey.set(objectKey);

                ProjectRevision restored = revisions.save(new ProjectRevision(project, nextVersion, objectKey,
                        source.getContentHash(), content.length));
                project.pointToSnapshot(nextVersion, objectKey, document.entry());
                projects.save(project);
                revisions.flush();
                projects.flush();
                return new ProjectResponses.SnapshotSaved(nextVersion, project.getLockVersion(), source.getContentHash(),
                        restored.getCreatedAt());
            });
        } catch (RuntimeException exception) {
            cleanupOrphan(uploadedKey.get(), exception);
            throw exception;
        }
    }

    /**
     * 禁止团队协作项目进入旧快照写入流程，避免两种存储模式混用。
     *
     * @param project 项目实体或摘要
     */
    private void rejectCollaboration(Project project) {
        if (project.getTeamId() != null && !project.isLegacyUnowned())
            throw new com.webeditor.collaboration.CollabFailure(403, "COLLAB_LEGACY_WRITE_DISABLED");
    }

    /**
     * 清理事务失败后已上传的孤儿快照；清理失败附加到原异常并记录日志，保留原失败原因。
     *
     * @param objectKey 存储对象键
     * @param original 待保留并追加清理错误的原异常
     */
    private void cleanupOrphan(String objectKey, RuntimeException original) {
        if (objectKey == null) {
            return;
        }
        try {
            storage.delete(objectKey);
        } catch (StorageException cleanupFailure) {
            original.addSuppressed(cleanupFailure);
            log.error("LEGACY_CLEANUP_FAILED");
        }
    }
}
