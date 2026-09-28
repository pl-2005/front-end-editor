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

    public ProjectResponses.SnapshotSaved save(long projectId, SaveSnapshotRequest request) {
        validator.validate(request.entry(), request.files());
        SnapshotCodec.EncodedSnapshot encoded = codec.encode(request.entry(), request.files());
        validator.validateEncodedSize(encoded.uncompressedBytes());
        AtomicReference<String> uploadedKey = new AtomicReference<>();

        try {
            return transactions.execute(status -> {
                Project project = projects.findActiveByIdForUpdate(projectId)
                        .orElseThrow(() -> new ResourceNotFoundException("项目不存在"));
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

    public ProjectResponses.SnapshotSaved restore(long projectId, int sourceVersion,
                                                   RestoreRevisionRequest request) {
        AtomicReference<String> uploadedKey = new AtomicReference<>();
        try {
            return transactions.execute(status -> {
                Project project = projects.findActiveByIdForUpdate(projectId)
                        .orElseThrow(() -> new ResourceNotFoundException("项目不存在"));
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

    private void cleanupOrphan(String objectKey, RuntimeException original) {
        if (objectKey == null) {
            return;
        }
        try {
            storage.delete(objectKey);
        } catch (StorageException cleanupFailure) {
            original.addSuppressed(cleanupFailure);
            log.error("Could not remove orphaned snapshot object {}", objectKey, cleanupFailure);
        }
    }
}
