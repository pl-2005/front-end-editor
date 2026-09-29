package com.webeditor.identity.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

@Service
public class RefreshStore {
    public record RefreshUser(long userId, long tokenVersion) {}
    private static final SecureRandom RANDOM = new SecureRandom();
    private final StringRedisTemplate redis;
    private final String namespace;
    private final Duration idle, maximum;
    private final int maxFamilies;
    public RefreshStore(StringRedisTemplate redis, @Value("${editor.auth.redis-namespace}") String namespace,
            @Value("${editor.auth.refresh-idle-timeout}") Duration idle,
            @Value("${editor.auth.refresh-max-lifetime}") Duration maximum,
            @Value("${editor.auth.max-refresh-families-per-user}") int maxFamilies) {
        this.redis = redis; this.namespace = namespace; this.idle = idle; this.maximum = maximum; this.maxFamilies = maxFamilies;
    }
    private String key(String part) { return namespace + ":" + part; }
    private static String random() { byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static final DefaultRedisScript<Long> ROTATE = new DefaultRedisScript<>("""
        local state = redis.call('GET', KEYS[1])
        if not state then return 0 end
        local family = redis.call('GET', KEYS[2])
        if not family then return 0 end
        if string.sub(state, 1, 5) == 'used:' then redis.call('DEL', KEYS[2]); return -1 end
        if state ~= ARGV[1] or family ~= ARGV[2] then return 0 end
        local ttl = redis.call('PTTL', KEYS[2])
        if ttl <= 0 or tonumber(ARGV[3]) > tonumber(ARGV[4]) then return 0 end
        redis.call('PSETEX', KEYS[1], ttl, 'used:' .. ARGV[5])
        redis.call('PSETEX', KEYS[3], ttl, ARGV[6])
        return 1
        """, Long.class);
    public String create(long userId, long version) {
        String family = UUID.randomUUID().toString();
        String value = userId + ":" + version + ":" + family;
        String token = random();
        redis.opsForValue().set(key("family:" + family), value, maximum);
        redis.opsForValue().set(key("token:" + digest(token)), value + ":" + Instant.now().plus(idle).toEpochMilli(), maximum);
        String index = key("families:" + userId);
        redis.opsForZSet().add(index, family, Instant.now().toEpochMilli());
        redis.expire(index, maximum);
        Long count = redis.opsForZSet().zCard(index);
        if (count != null && count > maxFamilies) {
            var old = redis.opsForZSet().range(index, 0, count - maxFamilies - 1);
            if (old != null) for (String item : old) { redis.delete(key("family:" + item)); redis.opsForZSet().remove(index, item); }
        }
        return token;
    }
    public record Rotated(String token, RefreshUser user) {}
    public Rotated rotate(String oldToken) {
        if (oldToken == null || !oldToken.matches("[A-Za-z0-9_-]{43}")) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        String oldKey = key("token:" + digest(oldToken));
        String value = redis.opsForValue().get(oldKey);
        if (value == null) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        if (value.startsWith("used:")) {
            redis.delete(key("family:" + value.substring(5)));
            throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        }
        String[] parts = value.split(":", 4);
        if (parts.length != 4) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        String next = random();
        String familyValue = parts[0] + ":" + parts[1] + ":" + parts[2];
        long now = Instant.now().toEpochMilli();
        Long result = redis.execute(ROTATE, List.of(oldKey, key("family:" + parts[2]), key("token:" + digest(next))),
                value, familyValue, Long.toString(now), parts[3], parts[2],
                familyValue + ":" + (now + idle.toMillis()));
        if (result == null || result != 1) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        return new Rotated(next, new RefreshUser(Long.parseLong(parts[0]), Long.parseLong(parts[1])));
    }
}
