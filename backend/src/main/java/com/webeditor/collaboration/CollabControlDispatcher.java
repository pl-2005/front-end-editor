package com.webeditor.collaboration;

import java.sql.Timestamp;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** At-least-once delivery; receiver watermarks survive restart. No network I/O under DB locks. */
@Component
public class CollabControlDispatcher {
    private static final Logger log = LoggerFactory.getLogger(CollabControlDispatcher.class);
    private final JdbcTemplate jdbc;
    private final CollabGatewayClient gateway;
    private final CollabDeleteService operations;
    private final boolean enabled;
    private final CollabMetrics metrics;
    @org.springframework.beans.factory.annotation.Autowired
    public CollabControlDispatcher(JdbcTemplate jdbc, CollabGatewayClient gateway, CollabDeleteService operations,
            @Value("${editor.collaboration.gateway.enabled:false}") boolean enabled, CollabMetrics metrics) {
        this.jdbc = jdbc; this.gateway = gateway; this.operations = operations; this.enabled = enabled;
        this.metrics = metrics;
    }
    public CollabControlDispatcher(JdbcTemplate jdbc, CollabGatewayClient gateway, CollabDeleteService operations, boolean enabled) {
        this(jdbc, gateway, operations, enabled, new CollabMetrics());
    }

    @Scheduled(initialDelay = 1000, fixedDelay = 1000)
    public synchronized void deliver() {
        if (!enabled) return;
        var events = jdbc.query("""
            SELECT * FROM collab_control_event WHERE acknowledged_at IS NULL AND next_attempt_at<=?
            ORDER BY created_at, aggregate_sequence LIMIT 50
            """, (rs, row) -> new CollabControlEvents.Event(rs.getString("id"), rs.getString("aggregate_id"),
                rs.getLong("aggregate_sequence"), rs.getString("event_type"), rs.getObject("project_id", Long.class),
                rs.getObject("user_id", Long.class), rs.getObject("team_id", Long.class), rs.getObject("epoch", Long.class),
                rs.getObject("authz_version", Long.class), rs.getString("operation_id")), Timestamp.from(Instant.now()));
        for (var event : events) {
            try {
                gateway.control(event);
                var now = Timestamp.from(Instant.now());
                jdbc.update("UPDATE collab_control_event SET delivered_at=?, acknowledged_at=?, attempts=attempts+1 WHERE id=?",
                        now, now, event.id());
                metrics.increment(CollabMetrics.Name.OUTBOX_ACK);
            } catch (RuntimeException failure) {
                metrics.increment(CollabMetrics.Name.OUTBOX_FAILURE);
                Integer attempts = jdbc.queryForObject("SELECT attempts FROM collab_control_event WHERE id=?", Integer.class, event.id());
                long delay = Math.min(60, 1L << Math.min(attempts, 6));
                jdbc.update("UPDATE collab_control_event SET attempts=attempts+1, next_attempt_at=? WHERE id=?",
                        Timestamp.from(Instant.now().plusSeconds(delay)), event.id());
                // Stable IDs only: never log HTTP bodies, binary state, credentials or fence tokens.
                log.warn("Collaboration control delivery failed event={} attempt={}", event.id(), attempts + 1);
            }
        }
    }

    @Scheduled(initialDelay = 15000, fixedDelay = 10000)
    public synchronized void reconcile() {
        if (!enabled) return;
        var ids = jdbc.query("SELECT id FROM collab_operation WHERE state='PREPARED' AND lease_until<=? LIMIT 50",
                (rs, row) -> rs.getString(1), Timestamp.from(Instant.now()));
        for (String id : ids) {
            try {
                var op = operations.operation(id);
                // Query gateway as well. An unavailable gateway never causes the fence to disappear.
                gateway.fence(op.projectId(), id);
                operations.abort(id);
            } catch (RuntimeException failure) { log.warn("Collaboration operation reconciliation pending operation={}", id); }
        }
    }
}
