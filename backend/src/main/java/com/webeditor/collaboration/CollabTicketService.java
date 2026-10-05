package com.webeditor.collaboration;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CollabTicketService {
    private final JdbcTemplate jdbc;
    private final boolean enabled;
    private final SecureRandom random = new SecureRandom();
    public record Ticket(String ticket, Instant expiresAt, long projectId, long epoch) {}
    public record Identity(long userId, String displayName, String avatarColor, long projectId,
                           long teamId, long epoch, String ticketId) {}
    public record Authorization(long userId, long projectId, long epoch, long authzVersion) {}
    private record State(long teamId, long epoch, long authzVersion, String displayName, String avatarColor) {}
    private static final String STATE = """
        SELECT p.team_id, d.epoch, u.authz_version, u.display_name, u.avatar_color
        FROM project p JOIN collab_document d ON d.project_id=p.id
        JOIN team t ON t.id=p.team_id AND t.status='ACTIVE'
        JOIN team_member m ON m.team_id=t.id AND m.status='ACTIVE'
        JOIN app_user u ON u.id=m.user_id
        WHERE p.id=? AND u.id=? AND p.status=1 AND p.legacy_unowned=FALSE
        """;
    public CollabTicketService(JdbcTemplate jdbc, @Value("${editor.collaboration.ticket-enabled:false}") boolean enabled) {
        this.jdbc = jdbc; this.enabled = enabled;
    }
    private void enabled() { if (!enabled) throw new CollabFailure(503, "COLLAB_TICKETS_DISABLED"); }
    private State state(long projectId, long userId) {
        return jdbc.query(STATE, (rs, row) -> new State(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5)),
                projectId, userId).stream().findFirst().orElseThrow(() -> new CollabFailure(403, "COLLAB_FORBIDDEN"));
    }
    @Transactional
    public Ticket issue(long projectId, long userId) {
        enabled(); State state = state(projectId, userId);
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant now = Instant.now(), expires = now.plusSeconds(60);
        jdbc.update("""
            INSERT INTO collab_ticket(id, token_hash, user_id, project_id, team_id, epoch, authz_version, issued_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, UUID.randomUUID().toString(), digest(token), userId, projectId, state.teamId(), state.epoch(),
                state.authzVersion(), Timestamp.from(now), Timestamp.from(expires));
        return new Ticket(token, expires, projectId, state.epoch());
    }
    /** Conditional UPDATE is the single-use gate; authorization is checked again inside this transaction. */
    @Transactional
    public Identity consume(String token, long projectId, long epoch) {
        enabled();
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw invalid();
        String digest = digest(token);
        int count = jdbc.update("""
            UPDATE collab_ticket SET consumed_at=?
            WHERE token_hash=? AND project_id=? AND epoch=? AND consumed_at IS NULL AND expires_at>?
            """, Timestamp.from(Instant.now()), digest, projectId, epoch, Timestamp.from(Instant.now()));
        if (count != 1) throw invalid();
        return jdbc.query("SELECT id, user_id, team_id, authz_version FROM collab_ticket WHERE token_hash=?", (rs, row) -> {
            long userId = rs.getLong("user_id"); State state = state(projectId, userId);
            if (state.epoch() != epoch || state.teamId() != rs.getLong("team_id") || state.authzVersion() != rs.getLong("authz_version")) throw invalid();
            return new Identity(userId, state.displayName(), state.avatarColor(), projectId, state.teamId(), epoch, rs.getString("id"));
        }, digest).getFirst();
    }
    /** New transaction/SQL read, never a cached handshake decision. */
    public Authorization revalidate(Authorization input) {
        enabled(); State state = state(input.projectId(), input.userId());
        if (state.epoch() != input.epoch() || state.authzVersion() != input.authzVersion()) throw new CollabFailure(403, "COLLAB_FORBIDDEN");
        return input;
    }
    // Initial authorization waterline is fetched separately so the ticket identity has no extra capabilities.
    public Authorization authorization(Identity identity) {
        long version = jdbc.queryForObject("SELECT authz_version FROM collab_ticket WHERE id=?", Long.class, identity.ticketId());
        return revalidate(new Authorization(identity.userId(), identity.projectId(), identity.epoch(), version));
    }
    private static String digest(String token) { return CollabPersistenceService.hash(token.getBytes(StandardCharsets.US_ASCII)); }
    private static CollabFailure invalid() { return new CollabFailure(401, "COLLAB_TICKET_INVALID"); }
}
