package com.webeditor.common.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Arrays;
import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Exact public origins protect cookie mutations before authentication or signing. */
@Component
public class AuthOriginFilter extends OncePerRequestFilter {
    private final Set<String> origins;
    private final SecurityErrors errors;
    public AuthOriginFilter(@Value("${editor.auth.allowed-origins}") String allowed,
            @Value("${editor.auth.cookie-secure:true}") boolean secure,
            @Value("${editor.auth.local-development:false}") boolean local, SecurityErrors errors) {
        this.errors = errors;
        if (!secure && !local) throw new IllegalArgumentException("Insecure auth cookies require explicit local development");
        origins = Arrays.stream(allowed.split(",", -1)).map(String::trim).collect(Collectors.toSet());
        for (String origin : origins) {
            URI uri = URI.create(origin);
            boolean loopback = Set.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost() == null ? "" : uri.getHost());
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                    || !uri.getRawPath().isEmpty() || !("https".equals(uri.getScheme()) || local && loopback && "http".equals(uri.getScheme()))
                    || !secure && !loopback) throw new IllegalArgumentException("Invalid auth origin configuration");
        }
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/auth/");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Cache-Control", "no-store");
        String path = request.getRequestURI();
        boolean mutation = "POST".equals(request.getMethod()) && Set.of("/api/auth/register", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout").contains(path)
                || "PUT".equals(request.getMethod()) && path.equals("/api/auth/password");
        if (mutation) {
            var values = Collections.list(request.getHeaders("Origin"));
            if (values.size() != 1 || !origins.contains(values.getFirst())
                    || !"browser".equals(request.getHeader("X-Web-Editor-Request"))
                    || "cross-site".equals(request.getHeader("Sec-Fetch-Site"))) {
                errors.write(request, response, 403, "AUTH_ORIGIN_REJECTED"); return;
            }
            try {
                var type = org.springframework.http.MediaType.parseMediaType(request.getContentType());
                if (!"application".equals(type.getType()) || !"json".equals(type.getSubtype())) throw new IllegalArgumentException();
            } catch (IllegalArgumentException e) { errors.write(request, response, 400, "VALIDATION_FAILED"); return; }
        }
        chain.doFilter(request, response);
    }
}
