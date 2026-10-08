package com.webeditor.identity.application;

import com.webeditor.identity.domain.AppUser;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
    private final JwtEncoder encoder;
    private final String issuer, audience;
    private final Duration ttl;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param encoder JWT 签名编码器
     * @param issuer JWT 签发方
     * @param audience 内部请求或令牌的受众标识
     * @param ttl 访问令牌有效期
     */
    public TokenService(JwtEncoder encoder, @Value("${editor.auth.issuer}") String issuer,
            @Value("${editor.auth.audience}") String audience,
            @Value("${editor.auth.access-ttl}") Duration ttl) {
        this.encoder = encoder; this.issuer = issuer; this.audience = audience; this.ttl = ttl;
        if (ttl.isNegative() || ttl.isZero() || ttl.toSeconds() == 0) throw new IllegalArgumentException("Access token lifetime must be positive seconds");
    }
    /**
     * 签发包含用户 ID、唯一 jti、时间声明和 token_version 的 HS256 访问令牌。
     *
     * @param user 用户实体
     * @return 已签名的 JWT 访问令牌
     */
    public String issue(AppUser user) {
        Instant now = Instant.now();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
                JwtClaimsSet.builder().issuer(issuer).audience(java.util.List.of(audience))
                        .subject(user.getId().toString()).id(UUID.randomUUID().toString())
                        .issuedAt(now).notBefore(now).expiresAt(now.plus(ttl))
                        .claim("token_version", user.getTokenVersion()).build())).getTokenValue();
    }
    /**
     * 返回访问令牌配置的有效期，单位为秒。
     */
    public long expiresIn() { return ttl.toSeconds(); }
}
