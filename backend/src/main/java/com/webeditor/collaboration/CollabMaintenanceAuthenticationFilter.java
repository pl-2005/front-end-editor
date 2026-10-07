package com.webeditor.collaboration;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Independent HMAC authentication inside the security chain, before authority checks. */
@Component
public class CollabMaintenanceAuthenticationFilter extends OncePerRequestFilter {
    private final CollabInternalAuth auth;
    private final String secret;
    public CollabMaintenanceAuthenticationFilter(CollabInternalAuth auth,
            @Value("${editor.collaboration.maintenance.secret:}") String secret,
            @Value("${editor.collaboration.storage-secret:}") String storage,
            @Value("${editor.collaboration.gateway.secret:}") String gateway,
            @Value("${editor.collaboration.initializer.secret:}") String initializer,
            @Value("${editor.auth.secret:}") String jwt) {
        if (!secret.isEmpty() && (java.nio.charset.StandardCharsets.UTF_8.encode(secret).remaining() < 32
                || secret.equals(storage) || secret.equals(gateway) || secret.equals(initializer) || secret.equals(jwt)))
            throw new IllegalArgumentException("Maintenance requires an independent secret");
        this.auth = auth; this.secret = secret;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !path.startsWith("/internal/collaboration/maintenance/") && !path.equals("/internal/collaboration/metrics");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        try {
            byte[] body = auth.authenticate(request, secret, "maintenance", 4096);
            request.setAttribute("maintenanceBody", body);
        } catch (CollabFailure failure) {
            response.setStatus(failure.status()); response.setContentType("application/json");
            response.getWriter().write("{\"code\":\"COLLAB_INTERNAL_UNAUTHORIZED\"}"); return;
        }
        try {
            SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("maintenance", null,
                    List.of(new SimpleGrantedAuthority("COLLAB_MAINTENANCE"))));
            chain.doFilter(request, response);
        } finally { SecurityContextHolder.clearContext(); }
    }
}
