package com.webeditor.identity.controller;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.webeditor.common.response.ApiResponse;
import com.webeditor.common.security.CurrentUser;
import com.webeditor.identity.application.AuthService;
import com.webeditor.identity.application.AuthRateLimiter;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Register(String username, String email, String password, String displayName) {}
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Refresh(String refreshToken) {}
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record ChangePassword(String currentPassword, String newPassword) {}
    private final AuthService auth;
    private final AuthRateLimiter limiter;
    public AuthController(AuthService auth, AuthRateLimiter limiter) { this.auth = auth; this.limiter = limiter; }
    @PostMapping(value = "/register", consumes = MediaType.APPLICATION_JSON_VALUE) ResponseEntity<ApiResponse<AuthService.UserView>> register(@RequestBody Register request, HttpServletRequest servlet) {
        limiter.check("register", null, servlet.getRemoteAddr());
        return ResponseEntity.status(201).body(ApiResponse.created(auth.register(request.username(), request.email(), request.password(), request.displayName())));
    }
    @PostMapping(value = "/refresh", consumes = MediaType.APPLICATION_JSON_VALUE) ApiResponse<AuthService.Credentials> refresh(@RequestBody Refresh request, HttpServletRequest servlet, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        limiter.check("refresh", null, servlet.getRemoteAddr());
        return ApiResponse.ok(auth.rotate(request.refreshToken()));
    }
    @GetMapping("/me") ApiResponse<AuthService.UserView> me() { return ApiResponse.ok(auth.me(CurrentUser.id())); }
    @PostMapping("/logout") ResponseEntity<Void> logout() { auth.logout(CurrentUser.id()); return ResponseEntity.noContent().build(); }
    @PutMapping(value = "/password", consumes = MediaType.APPLICATION_JSON_VALUE) ResponseEntity<Void> password(@RequestBody ChangePassword request) {
        auth.changePassword(CurrentUser.id(), request.currentPassword(), request.newPassword());
        return ResponseEntity.noContent().build();
    }
}
