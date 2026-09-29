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
    public TokenService(JwtEncoder encoder, @Value("${editor.auth.issuer}") String issuer,
            @Value("${editor.auth.audience}") String audience,
            @Value("${editor.auth.access-ttl}") Duration ttl) {
        this.encoder = encoder; this.issuer = issuer; this.audience = audience; this.ttl = ttl;
    }
    public String issue(AppUser user) {
        Instant now = Instant.now();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
                JwtClaimsSet.builder().issuer(issuer).audience(java.util.List.of(audience))
                        .subject(user.getId().toString()).id(UUID.randomUUID().toString())
                        .issuedAt(now).notBefore(now).expiresAt(now.plus(ttl))
                        .claim("token_version", user.getTokenVersion()).build())).getTokenValue();
    }
    public long expiresIn() { return ttl.toSeconds(); }
}
