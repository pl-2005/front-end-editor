package com.webeditor.collaboration;

import com.webeditor.project.repository.ProjectRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Offline current-content recovery. Failed operations remain fenced, including across restart. */
@Service
public class CollabRecoveryService {
    public record Recovery(long projectId, String operationId, long expectedEpoch, long expectedGeneration,
            String sourceObjectKey, String state, String targetObjectKey, String targetHash, Long targetSize, String lastCode) {}
    private final JdbcTemplate jdbc;
    private final ProjectRepository projects;
    private final CollabStore store;
    private final CollabObjectStorage storage;
    private final CollabInitializer encoder;
    private final CollabMaintenanceMode mode;
    private final TransactionTemplate tx;
    private final CollabMetrics metrics;
    private final java.time.Duration retention;
    public CollabRecoveryService(JdbcTemplate jdbc, ProjectRepository projects, CollabStore store,
            CollabObjectStorage storage, CollabInitializer encoder, CollabMaintenanceMode mode,
            TransactionTemplate tx, CollabMetrics metrics,
            @Value("${editor.collaboration.cleanup.recovery-window:30d}") java.time.Duration retention) {
        this.jdbc = jdbc; this.projects = projects; this.store = store; this.storage = storage;
        this.encoder = encoder; this.mode = mode; this.tx = tx; this.metrics = metrics; this.retention = retention;
    }
    public List<Long> projectsAfter(long after) {
        mode.require();
        return jdbc.query("SELECT id FROM project WHERE id>? AND status=1 AND team_id IS NOT NULL AND legacy_unowned=FALSE ORDER BY id LIMIT 100",
                (rs, row) -> rs.getLong(1), after);
    }
    public CollabPointer pointer(long id) {
        mode.require();
        return store.find(id).orElseThrow(CollabFailure::corrupt);
    }
    public Recovery status(long id) {
        return jdbc.query("SELECT * FROM collab_recovery WHERE project_id=?", (rs, row) -> new Recovery(id,
                rs.getString("operation_id"), rs.getLong("expected_epoch"), rs.getLong("expected_generation"),
                rs.getString("source_object_key"), rs.getString("state"), rs.getString("target_object_key"),
                rs.getString("target_hash"), rs.getObject("target_size", Long.class), rs.getString("last_code")), id)
                .stream().findFirst().orElse(null);
    }
    private void active(long id) {
        projects.findActiveByIdForUpdate(id).filter(p -> p.getTeamId() != null && !p.isLegacyUnowned())
                .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
    }
    public static void verify(CollabPointer p, byte[] bytes) {
        CollabPersistenceService.validateBytes(bytes);
        if (!p.objectKey().equals(CollabPointer.key(p.projectId(), p.epoch(), p.generation(), p.contentHash()))
                || !CollabPointer.CONTENT_TYPE.equals(p.contentType()) || bytes.length != p.size()
                || !CollabPersistenceService.hash(bytes).equals(p.contentHash())) throw CollabFailure.corrupt();
    }
    private CollabPointer receipt(Recovery r) {
        return new CollabPointer(r.projectId(), r.expectedEpoch() + 1, 1, r.targetObjectKey(), r.targetHash(), r.targetSize(), CollabPointer.CONTENT_TYPE);
    }
    /** Serialized in this single maintenance API instance; DB preconditions also fence stale commits. */
    public synchronized CollabPointer recover(long id, String operationId, long epoch, long generation) {
        mode.require();
        if (operationId == null || !operationId.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")
                || epoch < 1 || epoch >= 9007199254740991L || generation < 1)
            throw new CollabFailure(400, "COLLAB_INVALID_REQUEST");
        CollabPointer source = tx.execute(s -> {
            active(id); var p = store.lock(id); var prior = status(id);
            if (prior != null && prior.operationId().equals(operationId)) {
                if (prior.expectedEpoch() != epoch || prior.expectedGeneration() != generation)
                    throw new CollabFailure(409, "COLLAB_IDEMPOTENCY_CONFLICT");
                if ("COMMITTED".equals(prior.state())) return null;
            } else {
                if (prior != null && !"COMMITTED".equals(prior.state())) throw new CollabFailure(409, "COLLAB_OPERATION_IN_PROGRESS");
                CollabPersistenceService.expected(p, epoch, generation);
                if (jdbc.queryForObject("SELECT COUNT(*) FROM collab_operation WHERE project_id=? AND state='PREPARED'", Long.class, id) > 0)
                    throw new CollabFailure(409, "COLLAB_OPERATION_IN_PROGRESS");
                jdbc.update("DELETE FROM collab_recovery WHERE project_id=?", id);
                jdbc.update("INSERT INTO collab_recovery(project_id, operation_id, expected_epoch, expected_generation, source_object_key, state, updated_at) VALUES (?, ?, ?, ?, ?, 'PREPARED', ?)",
                        id, operationId, epoch, generation, p.objectKey(), Timestamp.from(Instant.now()));
            }
            CollabPersistenceService.expected(p, epoch, generation);
            // This durable reference protects the old object after pointer replacement as well.
            store.pinBackup("recovery_" + operationId, p.objectKey(), Instant.now().plus(retention));
            return p;
        });
        if (source == null) return receipt(status(id));
        try {
            byte[] bytes = storage.get(source.objectKey()); verify(source, bytes);
            byte[] rebuilt = encoder.rebuild(source, epoch + 1, bytes);
            CollabPersistenceService.validateBytes(rebuilt);
            String hash = CollabPersistenceService.hash(rebuilt);
            var target = new CollabPointer(id, epoch + 1, 1, CollabPointer.key(id, epoch + 1, 1, hash), hash, rebuilt.length, CollabPointer.CONTENT_TYPE);
            tx.executeWithoutResult(s -> {
                active(id); var current = store.lock(id); CollabPersistenceService.expected(current, epoch, generation);
                var r = status(id);
                if (!r.operationId().equals(operationId) || "COMMITTED".equals(r.state())) throw new CollabFailure(409, "COLLAB_OPERATION_IN_PROGRESS");
                store.lease(target.objectKey());
                jdbc.update("UPDATE collab_recovery SET state='PREPARED', target_object_key=?, target_hash=?, target_size=?, last_code=NULL, updated_at=? WHERE project_id=?",
                        target.objectKey(), hash, rebuilt.length, Timestamp.from(Instant.now()), id);
            });
            storage.put(target.objectKey(), rebuilt);
            verify(target, storage.get(target.objectKey()));
            tx.executeWithoutResult(s -> {
                active(id); var current = store.lock(id); CollabPersistenceService.expected(current, epoch, generation);
                var r = status(id);
                if (!r.operationId().equals(operationId) || !target.objectKey().equals(r.targetObjectKey()))
                    throw new CollabFailure(409, "COLLAB_OPERATION_IN_PROGRESS");
                store.requireLease(target.objectKey());
                int changed = jdbc.update("UPDATE collab_document SET epoch=?, generation=1, object_key=?, content_hash=?, size=?, lock_version=lock_version+1, updated_at=? WHERE project_id=? AND epoch=? AND generation=?",
                        target.epoch(), target.objectKey(), hash, target.size(), Timestamp.from(Instant.now()), id, epoch, generation);
                if (changed != 1) throw new CollabFailure(409, "COLLAB_GENERATION_CONFLICT");
                jdbc.update("UPDATE collab_recovery SET state='COMMITTED', last_code=NULL, updated_at=? WHERE project_id=? AND operation_id=?",
                        Timestamp.from(Instant.now()), id, operationId);
            });
            metrics.increment(CollabMetrics.Name.RECOVERY_SUCCESS); return target;
        } catch (RuntimeException failure) {
            // Unknown commit result stays closed; never roll back a committed pointer or expose exception text.
            try {
                tx.executeWithoutResult(s -> {
                    active(id); store.lock(id);
                    jdbc.update("UPDATE collab_recovery SET state='FAILED', last_code='COLLAB_RECOVERY_FAILED', updated_at=? WHERE project_id=? AND operation_id=? AND state<>'COMMITTED'",
                            Timestamp.from(Instant.now()), id, operationId);
                });
            } catch (RuntimeException unknown) { /* PREPARED is already a durable fence. */ }
            metrics.increment(CollabMetrics.Name.RECOVERY_FAILURE);
            throw new CollabFailure(503, "COLLAB_RECOVERY_FAILED");
        }
    }
}
