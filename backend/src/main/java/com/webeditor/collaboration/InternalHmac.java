package com.webeditor.collaboration;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class InternalHmac {
    /**
     * 禁止外部实例化此工具类。
     */
    private InternalHmac() {}
    /**
     * 以 HMAC-SHA256 签名方法、路径、受众、时间戳、nonce 和请求体摘要，拒绝过短密钥。
     *
     * @param secret 签名密钥
     * @param method HTTP 请求方法
     * @param path 目标路径
     * @param audience 内部请求或令牌的受众标识
     * @param timestamp 请求时间戳，单位为秒
     * @param nonce 单次请求随机标识
     * @param bytes 文档二进制内容
     */
    public static String sign(String secret, String method, String path, String audience, String timestamp, String nonce, byte[] bytes) {
        if (secret.getBytes(StandardCharsets.UTF_8).length < 32) throw new CollabFailure(503, "COLLAB_INTERNAL_UNCONFIGURED");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(String.join("\n", method, path, audience, timestamp, nonce, CollabPersistenceService.hash(bytes)).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    /**
     * 检查签名格式后使用恒定时间比较，返回提交签名是否匹配预期值。
     *
     * @param supplied 提交的签名
     * @param expected 服务端计算的有效签名
     */
    public static boolean matches(String supplied, String expected) {
        return supplied != null && supplied.matches("[a-f0-9]{64}")
                && MessageDigest.isEqual(HexFormat.of().parseHex(supplied), HexFormat.of().parseHex(expected));
    }
}
