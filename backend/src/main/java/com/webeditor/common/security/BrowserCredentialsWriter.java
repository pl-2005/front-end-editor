package com.webeditor.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.common.response.ApiResponse;
import com.webeditor.identity.application.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;

@Component
public class BrowserCredentialsWriter {
    private final ObjectMapper mapper;
    private final AuthCookie cookie;
    private final SecurityErrors errors;
    public BrowserCredentialsWriter(ObjectMapper mapper, AuthCookie cookie, SecurityErrors errors) {
        this.mapper = mapper; this.cookie = cookie; this.errors = errors;
    }
    public void write(HttpServletRequest request, HttpServletResponse response, AuthService.Credentials credentials, boolean rotated) throws IOException {
        try {
            byte[] body = mapper.writeValueAsBytes(ApiResponse.ok(credentials.browser()));
            response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
            response.setHeader("Cache-Control", "no-store");
            cookie.write(response, credentials.refreshToken(), credentials.cookieSeconds());
            response.getOutputStream().write(body);
        } catch (IOException | RuntimeException e) {
            if (response.isCommitted()) throw e;
            response.reset();
            errors.write(request, response, 503, rotated ? "AUTH_REFRESH_OUTCOME_UNKNOWN" : "AUTH_SERVICE_UNAVAILABLE");
        }
    }
}
