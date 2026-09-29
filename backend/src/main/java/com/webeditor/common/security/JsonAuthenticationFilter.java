package com.webeditor.common.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.common.response.ApiResponse;
import com.webeditor.identity.application.AuthFailure;
import com.webeditor.identity.application.AuthRateLimiter;
import com.webeditor.identity.application.AuthService;
import com.webeditor.identity.application.IdentityInput;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JsonAuthenticationFilter extends OncePerRequestFilter {
    private final AuthenticationManager manager;
    private final AuthRateLimiter limiter;
    private final SecurityErrors errors;
    private final ObjectMapper mapper;
    public JsonAuthenticationFilter(AuthenticationManager manager, AuthRateLimiter limiter,
            SecurityErrors errors, ObjectMapper mapper) {
        this.manager = manager; this.limiter = limiter; this.errors = errors; this.mapper = mapper;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getMethod().equals("POST") || !request.getRequestURI().equals("/api/auth/login");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Cache-Control", "no-store");
        if (request.getContentType() == null || !request.getContentType().startsWith(MediaType.APPLICATION_JSON_VALUE)) {
            errors.write(request, response, 400, "VALIDATION_FAILED");
            return;
        }
        JsonNode body;
        try {
            byte[] raw = request.getInputStream().readNBytes(8193);
            if (raw.length > 8192) { errors.write(request, response, 400, "VALIDATION_FAILED"); return; }
            body = mapper.readTree(raw);
        }
        catch (Exception e) { errors.write(request, response, 400, "VALIDATION_FAILED"); return; }
        if (body == null || !body.isObject() || body.size() != 2 || !body.hasNonNull("login")
                || !body.hasNonNull("password") || !body.get("login").isTextual() || !body.get("password").isTextual()) {
            errors.write(request, response, 400, "VALIDATION_FAILED");
            return;
        }
        String login = body.get("login").asText();
        String account;
        try { account = IdentityInput.normalize(login, 254); }
        catch (IllegalArgumentException e) { account = "invalid"; }
        try {
            limiter.check("login", account, request.getRemoteAddr());
            var authenticated = manager.authenticate(new UsernamePasswordAuthenticationToken(login, body.get("password").asText()));
            limiter.clearLogin(account);
            response.setStatus(200);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding("UTF-8");
            mapper.writeValue(response.getOutputStream(), ApiResponse.ok((AuthService.Credentials) authenticated.getPrincipal()));
        } catch (AuthRateLimiter.Limited e) {
            response.setHeader("Retry-After", Long.toString(e.retryAfter()));
            errors.write(request, response, 429, "AUTH_RATE_LIMITED");
        } catch (BadCredentialsException | AuthFailure e) {
            errors.write(request, response, 401, "AUTHENTICATION_REQUIRED");
        } catch (Exception e) {
            errors.write(request, response, 503, "AUTH_SERVICE_UNAVAILABLE");
        } finally { SecurityContextHolder.clearContext(); }
    }
}
