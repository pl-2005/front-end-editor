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
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param redis Redis 数据访问模板
     * @param namespace Redis 键命名空间
     * @param idle 刷新令牌空闲超时
     * @param maximum 令牌族最长生命周期
     * @param maxFamilies 每个用户允许的令牌族数
     */
    public RefreshStore(StringRedisTemplate redis, @Value("${editor.auth.redis-namespace}") String namespace,
            @Value("${editor.auth.refresh-idle-timeout}") Duration idle,
            @Value("${editor.auth.refresh-max-lifetime}") Duration maximum,
            @Value("${editor.auth.max-refresh-families-per-user}") int maxFamilies) {
        this.redis = redis; this.namespace = namespace; this.idle = idle; this.maximum = maximum; this.maxFamilies = maxFamilies;
        if (idle.isZero() || idle.isNegative() || maximum.isZero() || maximum.isNegative() || maxFamilies <= 0)
            throw new IllegalArgumentException("Auth lifetimes and family limit must be positive");
    }
    /**
     * 为刷新令牌相关 Redis 键添加配置的命名空间。
     *
     * @param part Redis 键的业务部分
     */
    private String key(String part) { return namespace + ":" + part; }
    /**
     * 生成 32 字节安全随机数并编码为无填充的 URL 安全刷新令牌。
     */
    private static String random() { byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    /**
     * 计算令牌的 SHA-256 十六进制摘要，供 Redis 索引使用。
     *
     * @param value 刷新令牌明文
     */
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
        return ttl
        """, Long.class);
    /**
     * 创建令牌族和首个刷新令牌，设置空闲与最长生命周期，并淘汰超过上限的旧令牌族。
     *
     * @param userId 用户 ID
     * @param version 版本号
     * @return 随机刷新令牌明文，Redis 仅以摘要索引
     */
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
    public record Prepared(String oldKey, String value, String family, RefreshUser user) {}
    public record Issued(String token, long cookieSeconds) {}
    public Issued issue(long userId, long version) {
        String token = create(userId, version);
        Prepared prepared = inspect(token);
        Long remaining = redis.getExpire(key("family:" + prepared.family()), java.util.concurrent.TimeUnit.MILLISECONDS);
        long idleRemaining = Long.parseLong(prepared.value().split(":", 4)[3]) - Instant.now().toEpochMilli();
        if (remaining == null || remaining <= 0 || idleRemaining <= 0) throw new AuthFailure(503, "AUTH_SERVICE_UNAVAILABLE");
        return new Issued(token, Math.min(idleRemaining, remaining) / 1000);
    }
    /** Read without consuming. Used tokens still revoke their family. */
    public Prepared inspect(String oldToken) {
        if (oldToken == null || !oldToken.matches("[A-Za-z0-9_-]{43}")) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        String oldKey = key("token:" + digest(oldToken));
        String value = redis.opsForValue().get(oldKey);
        if (value == null) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        if (value.startsWith("used:")) {
            redis.delete(key("family:" + value.substring(5)));
            throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        }
        String[] parts = value.split(":", 4);
        if (parts.length != 4 || Instant.now().toEpochMilli() > Long.parseLong(parts[3])
                || !(parts[0] + ":" + parts[1] + ":" + parts[2]).equals(redis.opsForValue().get(key("family:" + parts[2]))))
            throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        return new Prepared(oldKey, value, parts[2], new RefreshUser(Long.parseLong(parts[0]), Long.parseLong(parts[1])));
    }
    public String nextToken() { return random(); }
    /** Final Lua compare-and-swap; any execution failure has an unknown outcome. */
    public Issued commit(Prepared prepared, String next) {
        String[] parts = prepared.value().split(":", 4);
        String familyValue = parts[0] + ":" + parts[1] + ":" + parts[2];
        long now = Instant.now().toEpochMilli();
        Long result;
        try {
            result = redis.execute(ROTATE, List.of(prepared.oldKey(), key("family:" + parts[2]), key("token:" + digest(next))),
                    prepared.value(), familyValue, Long.toString(now), parts[3], parts[2], familyValue + ":" + (now + idle.toMillis()));
        } catch (RuntimeException e) { throw new AuthFailure(503, "AUTH_REFRESH_OUTCOME_UNKNOWN"); }
        if (result == null) throw new AuthFailure(503, "AUTH_REFRESH_OUTCOME_UNKNOWN");
        if (result <= 0) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
        return new Issued(next, Math.min(idle.toMillis(), result) / 1000);
    }
    /**
     * 用 Lua 原子将旧令牌标记已用并签发下一令牌；重放已用令牌会撤销整个令牌族。
     *
     * @param oldToken 待轮换的刷新令牌
     * @return 新刷新令牌及关联用户和令牌版本
     */
    public Rotated rotate(String oldToken) {
        Prepared prepared = inspect(oldToken);
        return new Rotated(commit(prepared, nextToken()).token(), prepared.user());
    }
}
