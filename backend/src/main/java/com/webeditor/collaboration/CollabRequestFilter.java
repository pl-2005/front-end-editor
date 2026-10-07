package com.webeditor.collaboration;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class CollabRequestFilter extends OncePerRequestFilter {
    private final CollabMaintenanceMode mode;
    private final CollabMetrics metrics;
    public CollabRequestFilter(CollabMaintenanceMode mode, CollabMetrics metrics) { this.mode = mode; this.metrics = metrics; }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String id = UUID.randomUUID().toString();
        request.setAttribute("requestId", id); response.setHeader("X-Request-ID", id);
        response.setHeader("Cache-Control", "no-store");
        String path = request.getRequestURI();
        if (mode.enabled() && path.startsWith("/api/") && !path.startsWith("/api/auth/")
                && !java.util.Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())) {
            response.setStatus(503); response.setContentType("application/json");
            response.getWriter().write("{\"code\":\"COLLAB_MAINTENANCE_REQUIRED\"}"); return;
        }
        try { chain.doFilter(request, response); }
        finally {
            if (response.getStatus() == 401) metrics.increment(CollabMetrics.Name.AUTH_FAILURE);
            if (response.getStatus() == 403) metrics.increment(CollabMetrics.Name.AUTHORIZATION_DENIED);
            if (path.endsWith("/collab-ticket") || path.equals("/internal/collaboration/tickets/consume")) {
                if (response.getStatus() >= 400) metrics.increment(CollabMetrics.Name.TICKET_REJECTED);
                else metrics.increment(path.endsWith("/collab-ticket") ? CollabMetrics.Name.TICKET_ISSUED : CollabMetrics.Name.TICKET_CONSUMED);
            }
        }
    }
}
