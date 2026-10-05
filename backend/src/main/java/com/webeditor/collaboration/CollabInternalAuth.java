package com.webeditor.collaboration;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.sql.Timestamp;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Authenticates bounded raw bodies before parsing; nonce insertion survives receiver restart. */
@Component
public class CollabInternalAuth {
    private final JdbcTemplate jdbc;
    private final String secret;
    public CollabInternalAuth(JdbcTemplate jdbc, @Value("${editor.collaboration.storage-secret:}") String secret) {
        this.jdbc = jdbc; this.secret = secret;
    }
    public byte[] authenticate(HttpServletRequest request) throws IOException {
        String timestamp = request.getHeader("X-Collab-Timestamp"), nonce = request.getHeader("X-Collab-Nonce");
        Instant now = Instant.now();
        if (secret.getBytes(StandardCharsets.UTF_8).length < 32 || request.getQueryString() != null
                || timestamp == null || !timestamp.matches("[0-9]{10}")
                || nonce == null || !nonce.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")
                || Math.abs(now.getEpochSecond() - Long.parseLong(timestamp)) > 30) throw unauthorized();
        byte[] body = request.getInputStream().readNBytes(CollabPointer.MAX_BYTES + 1);
        if (body.length > CollabPointer.MAX_BYTES) throw new CollabFailure(413, "COLLAB_DOCUMENT_TOO_LARGE");
        if (!InternalHmac.matches(request.getHeader("X-Collab-Signature"), InternalHmac.sign(secret,
                request.getMethod(), request.getRequestURI(), "storage", timestamp, nonce, body))) throw unauthorized();
        try {
            jdbc.update("INSERT INTO collab_hmac_nonce(audience, nonce, expires_at) VALUES ('storage', ?, ?)",
                    nonce, Timestamp.from(now.plusSeconds(61)));
        } catch (DuplicateKeyException e) { throw unauthorized(); }
        return body;
    }
    @Scheduled(initialDelay = 60000, fixedDelay = 60000)
    public void clean() {
        // Bounded retention; table may not exist in legacy test fixtures where Flyway targets V3.
        if (secret.getBytes(StandardCharsets.UTF_8).length < 32) return;
        jdbc.update("DELETE FROM collab_hmac_nonce WHERE expires_at < ?", Timestamp.from(Instant.now()));
        jdbc.update("DELETE FROM collab_ticket WHERE expires_at < ?", Timestamp.from(Instant.now().minusSeconds(300)));
    }
    private static CollabFailure unauthorized() { return new CollabFailure(401, "COLLAB_INTERNAL_UNAUTHORIZED"); }
}
