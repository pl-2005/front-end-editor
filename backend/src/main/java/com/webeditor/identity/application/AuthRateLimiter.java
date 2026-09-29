package com.webeditor.identity.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class AuthRateLimiter {
    private static final DefaultRedisScript<Long> COUNT = new DefaultRedisScript<>("""
            local n = redis.call('INCR', KEYS[1])
            if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
            if n > tonumber(ARGV[2]) then return math.max(1, redis.call('TTL', KEYS[1])) end
            return -n
            """, Long.class);
    public static class Limited extends RuntimeException {
        private final long retryAfter;
        public Limited(long retryAfter) { this.retryAfter = retryAfter; }
        public long retryAfter() { return retryAfter; }
    }
    private final StringRedisTemplate redis;
    private final String namespace;
    public AuthRateLimiter(StringRedisTemplate redis, @Value("${editor.auth.redis-namespace}") String namespace) {
        this.redis = redis; this.namespace = namespace;
    }
    private String key(String type, String value) {
        try { return namespace + ":limit:" + type + ":" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public void check(String action, String account, String ip) {
        long attempts = checkKey(key(action + ":ip", ip), action.equals("register") ? 10 : 30);
        if (account != null) attempts = Math.max(attempts, checkKey(key(action + ":account", account), 10));
        if (!action.equals("refresh")) {
            try { Thread.sleep(Math.min(500, Math.max(0, attempts - 1) * 50)); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException("Authentication interrupted", e); }
        }
    }
    private long checkKey(String key, int limit) {
        Long retry = redis.execute(COUNT, List.of(key), "300", Integer.toString(limit));
        if (retry == null) throw new IllegalStateException("Redis counter unavailable");
        if (retry > 0) throw new Limited(retry);
        return -retry;
    }
    public void clearLogin(String account) { redis.delete(key("login:account", account)); }
}
