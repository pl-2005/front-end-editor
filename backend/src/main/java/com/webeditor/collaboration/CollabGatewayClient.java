package com.webeditor.collaboration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class CollabGatewayClient {
    public record Durable(long projectId, long epoch, long generation, String contentHash, long durableSequence) {}
    private final boolean enabled;
    private final boolean ticketsEnabled;
    private final String baseUrl, secret;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(3)).build();
    public CollabGatewayClient(ObjectMapper json, @Value("${editor.collaboration.gateway.enabled:false}") boolean enabled,
            @Value("${editor.collaboration.ticket-enabled:false}") boolean ticketsEnabled,
            @Value("${editor.collaboration.gateway.url:http://127.0.0.1:8092}") String baseUrl,
            @Value("${editor.collaboration.gateway.secret:}") String secret) {
        this.json = json; this.enabled = enabled; this.ticketsEnabled = ticketsEnabled; this.baseUrl = baseUrl; this.secret = secret;
    }
    /** Gateway-disabled Step05 can read a pointer directly; enabled rooms must ACK before copy reservation. */
    public Durable flush(long projectId) {
        if (!enabled) {
            if (ticketsEnabled) throw new CollabFailure(503, "COLLAB_FLUSH_REQUIRED");
            return null;
        }
        String path = "/internal/collaboration/projects/" + projectId + "/flush";
        String timestamp = Long.toString(Instant.now().getEpochSecond()), nonce = UUID.randomUUID().toString();
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(15))
                    .header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce)
                    .header("X-Collab-Signature", InternalHmac.sign(secret, "POST", path, "gateway", timestamp, nonce, new byte[0]))
                    .POST(HttpRequest.BodyPublishers.noBody()).build();
            var response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (var stream = response.body()) {
                byte[] bytes = stream.readNBytes(4097);
                if (response.statusCode() != 200 || bytes.length > 4096) throw new CollabFailure(503, "COLLAB_FLUSH_FAILED");
                Durable result = json.readValue(bytes, Durable.class);
                if (result.projectId() != projectId || result.epoch() < 1 || result.generation() < 1
                        || result.contentHash() == null || !result.contentHash().matches("[a-f0-9]{64}"))
                    throw new CollabFailure(503, "COLLAB_FLUSH_FAILED");
                return result;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw new CollabFailure(503, "COLLAB_FLUSH_FAILED");
        } catch (java.io.IOException | IllegalArgumentException e) { throw new CollabFailure(503, "COLLAB_FLUSH_FAILED"); }
    }
}
