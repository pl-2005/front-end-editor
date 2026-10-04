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
        /**
         * 创建携带剩余等待秒数的限流异常。
         *
         * @param retryAfter 允许重试前的等待秒数
         */
        public Limited(long retryAfter) { this.retryAfter = retryAfter; }
        /**
         * 返回限流窗口剩余的等待秒数。
         */
        public long retryAfter() { return retryAfter; }
    }
    private final StringRedisTemplate redis;
    private final String namespace;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param redis Redis 数据访问模板
     * @param namespace Redis 键命名空间
     */
    public AuthRateLimiter(StringRedisTemplate redis, @Value("${editor.auth.redis-namespace}") String namespace) {
        this.redis = redis; this.namespace = namespace;
    }
    /**
     * 将限流维度和标识摘要组合为 Redis 键，避免在键中保存明文账号或 IP。
     *
     * @param type 限流键的维度类型
     * @param value 待规范化或处理的文本
     */
    private String key(String type, String value) {
        try { return namespace + ":limit:" + type + ":" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    /**
     * 按 IP 及可选账号执行五分钟窗口限流，对非刷新请求施加随尝试次数递增的短延迟。
     *
     * @param action 登录、注册或刷新等限流动作标识
     * @param account 规范化账号，允许为空
     * @param ip 请求来源 IP
     */
    public void check(String action, String account, String ip) {
        long attempts = checkKey(key(action + ":ip", ip), action.equals("register") ? 10 : 30);
        if (account != null) attempts = Math.max(attempts, checkKey(key(action + ":account", account), 10));
        if (!action.equals("refresh")) {
            try { Thread.sleep(Math.min(500, Math.max(0, attempts - 1) * 50)); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException("Authentication interrupted", e); }
        }
    }
    /**
     * 使用 Redis Lua 原子增加计数；超过阈值时抛出携带剩余等待秒数的限流异常。
     *
     * @param key 当前限流维度的 Redis 键
     * @param limit 窗口内允许的最大请求数
     */
    private long checkKey(String key, int limit) {
        Long retry = redis.execute(COUNT, List.of(key), "300", Integer.toString(limit));
        if (retry == null) throw new IllegalStateException("Redis counter unavailable");
        if (retry > 0) throw new Limited(retry);
        return -retry;
    }
    /**
     * 登录成功后清除该账号的登录失败计数，保留 IP 维度计数。
     *
     * @param account 规范化账号，允许为空
     */
    public void clearLogin(String account) { redis.delete(key("login:account", account)); }
}
