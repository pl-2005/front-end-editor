package com.webeditor.collaboration;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Routes require COLLAB_MAINTENANCE authority established by the independent HMAC filter. */
@RestController
@RequestMapping("/internal/collaboration")
public class CollabMaintenanceController {
    private final CollabRecoveryService recovery;
    private final CollabBackupService backups;
    private final CollabObjectStorage storage;
    private final CollabMaintenanceMode mode;
    private final CollabMetrics metrics;
    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    public CollabMaintenanceController(CollabRecoveryService recovery, CollabBackupService backups, CollabObjectStorage storage,
            CollabMaintenanceMode mode, CollabMetrics metrics, JdbcTemplate jdbc, StringRedisTemplate redis, ObjectMapper mapper) {
        this.recovery = recovery; this.backups = backups; this.storage = storage; this.mode = mode;
        this.metrics = metrics; this.jdbc = jdbc; this.redis = redis; this.mapper = mapper;
    }
    public record Recover(String operationId, long epoch, long generation) {}
    public record Backup(Instant retainUntil) {}
    public record BackupProject(long projectId, boolean active) {}
    @GetMapping("/maintenance/documents/after/{after}")
    public List<BackupProject> documents(@PathVariable long after) {
        mode.require();
        return jdbc.query("SELECT p.id, p.status FROM project p JOIN collab_document d ON d.project_id=p.id WHERE p.id>? AND p.team_id IS NOT NULL AND p.legacy_unowned=FALSE ORDER BY p.id LIMIT 100",
                (rs, row) -> new BackupProject(rs.getLong(1), rs.getInt(2) == 1), after);
    }
    @GetMapping("/maintenance/projects/{id}/pointer")
    public CollabPointer pointer(@PathVariable long id) { return recovery.pointer(id); }
    @GetMapping("/maintenance/projects/after/{after}")
    public List<Long> projects(@PathVariable long after) { return recovery.projectsAfter(after); }
    @GetMapping("/maintenance/projects/{id}/status")
    public Object status(@PathVariable long id) {
        mode.require(); var state = recovery.status(id);
        return state == null ? Map.of("projectId", id, "state", "NONE") : state;
    }
    @PostMapping("/maintenance/projects/{id}/recover")
    public CollabPointer recover(@PathVariable long id, HttpServletRequest request) throws java.io.IOException {
        var input = mapper.readValue((byte[]) request.getAttribute("maintenanceBody"), Recover.class);
        return recovery.recover(id, input.operationId(), input.epoch(), input.generation());
    }
    @PostMapping("/maintenance/projects/{id}/backups/{backupId}")
    public CollabPointer backup(@PathVariable long id, @PathVariable String backupId, HttpServletRequest request) throws java.io.IOException {
        mode.require(); var input = mapper.readValue((byte[]) request.getAttribute("maintenanceBody"), Backup.class);
        var p = backups.pinCurrent(id, backupId, input.retainUntil());
        // Soft deletion increments metadata epoch but deliberately retains the old binary object.
        var match = java.util.regex.Pattern.compile("collab/projects/" + id + "/epochs/([1-9][0-9]*)/([1-9][0-9]*)-([a-f0-9]{64})\\.yjs").matcher(p.objectKey());
        if (!match.matches() || !match.group(3).equals(p.contentHash())) throw CollabFailure.corrupt();
        var objectPointer = new CollabPointer(id, Long.parseLong(match.group(1)), Long.parseLong(match.group(2)), p.objectKey(), p.contentHash(), p.size(), p.contentType());
        CollabRecoveryService.verify(objectPointer, storage.get(p.objectKey())); return objectPointer;
    }
    @GetMapping("/maintenance/projects/{id}/backups/{backupId}/object")
    public ResponseEntity<byte[]> object(@PathVariable long id, @PathVariable String backupId) {
        mode.require();
        var keys = jdbc.query("SELECT object_key FROM collab_backup_reference WHERE backup_id=? AND object_key LIKE ? AND retain_until>?",
                (rs, row) -> rs.getString(1), backupId, "collab/projects/" + id + "/%", java.sql.Timestamp.from(Instant.now()));
        if (keys.size() != 1) throw new CollabFailure(409, "COLLAB_BACKUP_AMBIGUOUS");
        return ResponseEntity.ok().header("Content-Type", CollabPointer.CONTENT_TYPE).body(storage.get(keys.getFirst()));
    }
    @GetMapping("/metrics")
    public Map<String, Object> metrics() {
        boolean available = false;
        try (var connection = redis.getConnectionFactory().getConnection()) { available = "PONG".equals(connection.ping()); }
        catch (RuntimeException failure) { metrics.increment(CollabMetrics.Name.REDIS_FAILURE); }
        var oldest = jdbc.queryForObject("SELECT MIN(created_at) FROM collab_control_event WHERE acknowledged_at IS NULL", java.sql.Timestamp.class);
        return Map.of("counters", metrics.snapshot(), "redisAvailable", available,
                "preparedOperations", jdbc.queryForObject("SELECT COUNT(*) FROM collab_operation WHERE state='PREPARED'", Long.class),
                "outboxPending", jdbc.queryForObject("SELECT COUNT(*) FROM collab_control_event WHERE acknowledged_at IS NULL", Long.class),
                "outboxLagSeconds", oldest == null ? 0 : Math.max(0, java.time.Duration.between(oldest.toInstant(), Instant.now()).toSeconds()),
                "recoveryBlocked", jdbc.queryForObject("SELECT COUNT(*) FROM collab_recovery WHERE state<>'COMMITTED'", Long.class));
    }
}
