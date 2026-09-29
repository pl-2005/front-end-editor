package com.webeditor.common.security;

import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtDecoder decoder;
    private final AppUserRepository users;
    private final SecurityErrors errors;
    private final String issuer, audience;
    public JwtAuthenticationFilter(JwtDecoder decoder, AppUserRepository users, SecurityErrors errors,
            @Value("${editor.auth.issuer}") String issuer, @Value("${editor.auth.audience}") String audience) {
        this.decoder = decoder; this.users = users; this.errors = errors;
        this.issuer = issuer; this.audience = audience;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        String method = request.getMethod();
        return !path.startsWith("/api/") || "OPTIONS".equals(method)
                || "POST".equals(method) && (path.equals("/api/auth/register") || path.equals("/api/auth/login") || path.equals("/api/auth/refresh"))
                || "GET".equals(method) && (path.equals("/api/health") || path.equals("/api/health/readiness") || path.equals("/api/teams/discover"));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Long authenticatedId;
        try {
            var values = java.util.Collections.list(request.getHeaders(HttpHeaders.AUTHORIZATION));
            if (values.size() != 1 || !values.getFirst().matches("Bearer [A-Za-z0-9._~+/_-]+")) throw new IllegalArgumentException();
            Jwt jwt = decoder.decode(values.getFirst().substring(7));
            Instant now = Instant.now();
            if (!issuer.equals(jwt.getClaimAsString("iss"))
                    || !jwt.getAudience().contains(audience) || jwt.getId() == null || jwt.getId().isBlank()
                    || jwt.getIssuedAt() == null || jwt.getIssuedAt().isAfter(now.plusSeconds(30))
                    || jwt.getNotBefore() == null || jwt.getNotBefore().isAfter(now.plusSeconds(30))
                    || jwt.getExpiresAt() == null || !jwt.getExpiresAt().isAfter(now.minusSeconds(30))
                    || jwt.getIssuedAt().isAfter(jwt.getExpiresAt())
                    || jwt.getNotBefore().isAfter(jwt.getExpiresAt())) throw new IllegalArgumentException();
            long id = Long.parseLong(jwt.getSubject());
            AppUser user = users.findById(id).orElseThrow();
            Number version = jwt.getClaim("token_version");
            if (version == null || user.getTokenVersion() != version.longValue()) throw new IllegalArgumentException();
            authenticatedId = id;
        } catch (Exception exception) {
            errors.write(request, response, 401, "AUTHENTICATION_REQUIRED");
            return;
        }
        try {
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(authenticatedId, null, List.of()));
            chain.doFilter(request, response);
        } finally { SecurityContextHolder.clearContext(); }
    }
}
