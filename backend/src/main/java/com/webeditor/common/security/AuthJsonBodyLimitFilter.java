package com.webeditor.common.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ReadListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class AuthJsonBodyLimitFilter extends OncePerRequestFilter {
    private static final int MAX_BYTES = 8192;
    private final SecurityErrors errors;
    public AuthJsonBodyLimitFilter(SecurityErrors errors) { this.errors = errors; }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !(request.getMethod().equals("POST") && (request.getRequestURI().equals("/api/auth/login")
                || request.getRequestURI().equals("/api/auth/register") || request.getRequestURI().equals("/api/auth/refresh")))
                && !(request.getMethod().equals("PUT") && request.getRequestURI().equals("/api/auth/password"));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > MAX_BYTES) {
            errors.write(request, response, 400, "VALIDATION_FAILED");
            return;
        }
        byte[] body = request.getInputStream().readNBytes(MAX_BYTES + 1);
        if (body.length > MAX_BYTES) {
            errors.write(request, response, 400, "VALIDATION_FAILED");
            return;
        }
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() {
                ByteArrayInputStream input = new ByteArrayInputStream(body);
                return new ServletInputStream() {
                    @Override public boolean isFinished() { return input.available() == 0; }
                    @Override public boolean isReady() { return true; }
                    @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                    @Override public int read() { return input.read(); }
                };
            }
            @Override public BufferedReader getReader() {
                return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
            }
        }, response);
    }
}
