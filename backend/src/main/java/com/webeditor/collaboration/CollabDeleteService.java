package com.webeditor.collaboration;

import com.webeditor.common.exception.ProjectStateConflictException;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.team.application.TeamAccessService;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Short DB transactions surround the network fence/flush, never the reverse. */
@Service
public class CollabDeleteService {
    public record Operation(String id, long projectId, long userId, long expectedLockVersion,
            long expectedEpoch, long expectedGeneration, String state, String fenceToken, Long durableGeneration) {}
    public record Control(long projectId, long epoch, String state, String operationId) {}
    private final JdbcTemplate jdbc;
    private final ProjectRepository projects;
    private final TeamAccessService access;
    private final CollabStore store;
    private final CollabGatewayClient gateway;
    private final CollabControlEvents events;
    private final TransactionTemplate tx;
    public CollabDeleteService(JdbcTemplate jdbc, ProjectRepository projects, TeamAccessService access,
            CollabStore store, CollabGatewayClient gateway, CollabControlEvents events, TransactionTemplate tx) {
        this.jdbc = jdbc; this.projects = projects; this.access = access; this.store = store;
        this.gateway = gateway; this.events = events; this.tx = tx;
    }

    public Operation operation(String id) {
        return operation(id, false);
    }
    private Operation operation(String id, boolean lock) {
        return jdbc.query("SELECT * FROM collab_operation WHERE id=?" + (lock ? " FOR UPDATE" : ""), (rs, row) -> new Operation(
                rs.getString("id"), rs.getLong("project_id"), rs.getLong("user_id"), rs.getLong("expected_lock_version"),
                rs.getLong("expected_epoch"), rs.getLong("expected_generation"), rs.getString("state"),
                rs.getString("fence_token"), rs.getObject("durable_generation", Long.class)), id).stream()
                .findFirst().orElseThrow(() -> new CollabFailure(404, "COLLAB_OPERATION_NOT_FOUND"));
    }

    public Control control(long id) {
        var p = projects.findById(id).filter(project -> project.getTeamId() != null && !project.isLegacyUnowned())
                .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
        var pointer = store.find(id).orElseThrow(CollabFailure::corrupt);
        String op = jdbc.query("SELECT id FROM collab_operation WHERE project_id=? AND state='PREPARED'",
                (rs, row) -> rs.getString(1), id).stream().findFirst().orElse(null);
        return new Control(id, pointer.epoch(), p.getStatus() == 0 ? "DELETED" : op == null ? "ACTIVE" : "FENCED", op);
    }

    public void delete(long teamId, long projectId, long userId, long version) {
        Operation op = tx.execute(status -> {
            access.member(teamId, userId);
            var project = projects.findByIdForUpdate(projectId)
                    .filter(p -> Long.valueOf(teamId).equals(p.getTeamId()) && !p.isLegacyUnowned())
                    .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
            var prior = jdbc.query("SELECT id FROM collab_operation WHERE project_id=? AND expected_lock_version=? AND operation_type='DELETE' AND state<>'ABORTED' FOR UPDATE",
                    (rs, row) -> rs.getString(1), projectId, version).stream().findFirst();
            if (prior.isPresent()) {
                var existing = operation(prior.get(), true);
                if ("COMMITTED".equals(existing.state())) return existing;
                if (existing.userId() != userId) throw new CollabFailure(409, "COLLAB_OPERATION_IN_PROGRESS");
                return existing;
            }
            if (project.getStatus() != 1) throw new CollabFailure(404, "PROJECT_NOT_FOUND");
            if (project.getLockVersion() != version) throw new ProjectStateConflictException("项目已修改，请刷新后重试");
            if (jdbc.queryForObject("SELECT COUNT(*) FROM collab_operation WHERE project_id=? AND state='PREPARED'", Long.class, projectId) > 0)
                throw new CollabFailure(409, "COLLAB_OPERATION_IN_PROGRESS");
            var pointer = store.lock(projectId);
            String id = UUID.randomUUID().toString(); var now = Timestamp.from(Instant.now());
            jdbc.update("""
                INSERT INTO collab_operation(id, project_id, user_id, operation_type, expected_lock_version,
                    expected_epoch, expected_generation, state, lease_until, created_at, updated_at)
                VALUES (?, ?, ?, 'DELETE', ?, ?, ?, 'PREPARED', ?, ?, ?)
                """, id, projectId, userId, version, pointer.epoch(), pointer.generation(),
                    Timestamp.from(Instant.now().plusSeconds(60)), now, now);
            return operation(id);
        });
        if ("COMMITTED".equals(op.state())) return;
        // If ACK is lost, PREPARED remains fenced and reconciliation queries the durable operation.
        CollabGatewayClient.Fence ack;
        try { ack = gateway.fence(projectId, op.id()); }
        catch (RuntimeException unavailable) {
            // A concurrent retry may have committed while this request was reaching the gateway.
            try { if ("COMMITTED".equals(operation(op.id()).state())) return; }
            catch (RuntimeException unknown) { /* No database proof: keep the original failure and fence. */ }
            throw unavailable;
        }
        try {
            tx.executeWithoutResult(status -> {
                var project = projects.findByIdForUpdate(projectId).orElseThrow();
                var current = operation(op.id(), true);
                if ("COMMITTED".equals(current.state())) return;
                if (!"PREPARED".equals(current.state())) throw new CollabFailure(409, "COLLAB_OPERATION_ABORTED");
                access.project(teamId, projectId, userId);
                if (project.getLockVersion() != version) throw new ProjectStateConflictException("项目已修改，请刷新后重试");
                var pointer = store.lock(projectId);
                if (ack.projectId() != projectId || !ack.operationId().equals(op.id()) || ack.epoch() != op.expectedEpoch()
                        || pointer.epoch() != ack.epoch() || pointer.generation() != ack.generation()
                        || !pointer.contentHash().equals(ack.contentHash()) || ack.generation() < op.expectedGeneration())
                    throw new CollabFailure(409, "COLLAB_FENCE_CONFLICT");
                jdbc.update("UPDATE collab_document SET epoch=epoch+1, lock_version=lock_version+1, updated_at=? WHERE project_id=?",
                        Timestamp.from(Instant.now()), projectId);
                project.delete(); projects.flush();
                jdbc.update("UPDATE collab_operation SET state='COMMITTED', fence_token=?, durable_generation=?, durable_hash=?, updated_at=? WHERE id=?",
                        ack.fenceToken(), ack.generation(), ack.contentHash(), Timestamp.from(Instant.now()), op.id());
                events.operation(projectId, nextSequence(projectId), ack.epoch() + 1, op.id(), true);
            });
        } catch (RuntimeException failure) {
            // The new transaction proves the previous transaction's outcome before any un-fence.
            try { abort(op.id()); } catch (RuntimeException unknown) { /* Keep the fence until DB recovers. */ }
            throw failure;
        }
    }

    private long nextSequence(long projectId) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(aggregate_sequence), 0)+1 FROM collab_control_event WHERE aggregate_id=?",
                Long.class, "project:" + projectId);
    }

    public void abort(String id) {
        var initial = operation(id);
        tx.executeWithoutResult(status -> {
            var project = projects.findByIdForUpdate(initial.projectId()).orElseThrow();
            var op = operation(id, true);
            if (!"PREPARED".equals(op.state())) return;
            // Deleted or changed epochs are ambiguous; never infer ABORT from a timeout alone.
            var pointer = store.lock(op.projectId());
            if (project.getStatus() != 1 || pointer.epoch() != op.expectedEpoch()) return;
            jdbc.update("UPDATE collab_operation SET state='ABORTED', updated_at=? WHERE id=?", Timestamp.from(Instant.now()), id);
            events.operation(op.projectId(), nextSequence(op.projectId()), pointer.epoch(), id, false);
        });
    }
}
