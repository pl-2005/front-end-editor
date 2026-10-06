package com.webeditor.collaboration;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Outbox records are always written by the transaction changing their aggregate. */
@Service
public class CollabControlEvents {
    public record Event(String id, String aggregateId, long aggregateSequence, String eventType,
            Long projectId, Long userId, Long teamId, Long epoch, Long authzVersion, String operationId) {}
    private final JdbcTemplate jdbc;
    public CollabControlEvents(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional(propagation = Propagation.MANDATORY)
    public void revoked(long userId, Long teamId, long version) {
        append(new Event(UUID.randomUUID().toString(), "user:" + userId, version, "USER_REVOKED",
                null, userId, teamId, null, version, null));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void operation(long projectId, long sequence, long epoch, String operationId, boolean deleted) {
        append(new Event(UUID.randomUUID().toString(), "project:" + projectId, sequence,
                deleted ? "PROJECT_DELETED" : "OPERATION_ABORTED", projectId, null, null, epoch, null, operationId));
    }

    private void append(Event e) {
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
            INSERT INTO collab_control_event(id, aggregate_id, aggregate_sequence, event_type, project_id,
                user_id, team_id, epoch, authz_version, operation_id, created_at, next_attempt_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, e.id(), e.aggregateId(), e.aggregateSequence(), e.eventType(), e.projectId(), e.userId(),
                e.teamId(), e.epoch(), e.authzVersion(), e.operationId(), now, now);
    }
}
