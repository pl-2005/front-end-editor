package com.webeditor.common.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.OctetSequenceKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@Configuration
public class JwtKeys {
    /**
     * 校验密钥至少包含 32 个 UTF-8 字节，并创建 HMAC-SHA256 签名密钥。
     *
     * @param secret 签名密钥
     */
    @Bean public SecretKey jwtSigningKey(@Value("${editor.auth.secret}") String secret) {
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) throw new IllegalStateException("JWT_SECRET must be at least 32 UTF-8 bytes");
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    /**
     * 用共享密钥创建 HS256 JWT 编码器。
     *
     * @param key HS256 共享签名密钥
     */
    @Bean JwtEncoder jwtEncoder(SecretKey key) {
        var jwk = new OctetSequenceKey.Builder(key.getEncoded()).algorithm(JWSAlgorithm.HS256).build();
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
    }
    /**
     * 创建仅使用 HS256 共享密钥验证签名的 JWT 解码器。
     *
     * @param key HS256 共享签名密钥
     */
    @Bean JwtDecoder jwtDecoder(SecretKey key) {
        return NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }
}
