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
    public record LogoutResult(String outcome) {}
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record ChangePassword(String currentPassword, String newPassword) {}
    private final AuthService auth;
    private final AuthRateLimiter limiter;
    private final com.webeditor.common.security.AuthCookie cookie;
    private final com.webeditor.common.security.BrowserCredentialsWriter writer;
    private final com.fasterxml.jackson.databind.ObjectMapper mapper;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param auth 认证服务
     * @param limiter 认证及公共接口限流器
     */
    public AuthController(AuthService auth, AuthRateLimiter limiter, com.webeditor.common.security.AuthCookie cookie,
            com.webeditor.common.security.BrowserCredentialsWriter writer, com.fasterxml.jackson.databind.ObjectMapper mapper) {
        this.auth = auth; this.limiter = limiter; this.cookie = cookie; this.writer = writer; this.mapper = mapper;
    }
    private void emptyBody(HttpServletRequest request) throws java.io.IOException {
        byte[] raw = request.getInputStream().readNBytes(8193);
        if (raw.length > 8192) throw new IllegalArgumentException("请求正文过大");
        com.fasterxml.jackson.databind.JsonNode body;
        try { body = mapper.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(raw); }
        catch (java.io.IOException e) { throw new IllegalArgumentException("请求正文格式无效"); }
        if (body == null || !body.isObject() || body.size() != 0) throw new IllegalArgumentException("请求正文必须为空对象");
    }
    /**
     * 按来源 IP 限流后注册用户，返回 201 和公开用户资料。
     *
     * @param request 业务请求数据，字段约束见请求类型
     * @param servlet HTTP 请求，用于读取来源 IP
     */
    @PostMapping(value = "/register", consumes = MediaType.APPLICATION_JSON_VALUE) ResponseEntity<ApiResponse<AuthService.UserView>> register(@RequestBody Register request, HttpServletRequest servlet) {
        limiter.check("register", null, servlet.getRemoteAddr());
        return ResponseEntity.status(201).body(ApiResponse.created(auth.register(request.username(), request.email(), request.password(), request.displayName())));
    }
    /**
     * 按来源 IP 限流并轮换刷新令牌，禁止缓存新凭据。
     *
     * @param request 业务请求数据，字段约束见请求类型
     * @param servlet HTTP 请求，用于读取来源 IP
     * @param response HTTP 响应
     */
    @PostMapping(value = "/refresh", consumes = MediaType.APPLICATION_JSON_VALUE) void refresh(HttpServletRequest servlet, HttpServletResponse response) throws java.io.IOException {
        response.setHeader("Cache-Control", "no-store");
        emptyBody(servlet);
        limiter.check("refresh", null, servlet.getRemoteAddr());
        try { writer.write(servlet, response, auth.rotate(cookie.read(servlet)), true); }
        catch (com.webeditor.identity.application.AuthFailure e) {
            if (e.status() == 401) cookie.clear(response);
            throw e;
        }
    }
    /**
     * 返回当前已认证用户的公开资料。
     */
    @GetMapping("/me") ApiResponse<AuthService.UserView> me() { return ApiResponse.ok(auth.me(CurrentUser.id())); }
    /**
     * 撤销当前用户所有已有会话，成功返回 204。
     */
    @PostMapping(value = "/logout", consumes = MediaType.APPLICATION_JSON_VALUE)
    ApiResponse<LogoutResult> logout(HttpServletRequest request, HttpServletResponse response) throws java.io.IOException {
        emptyBody(request);
        String outcome;
        try { outcome = auth.logoutCookie(cookie.read(request)); }
        catch (com.webeditor.identity.application.AuthFailure e) {
            if (e.status() != 401) throw e;
            outcome = "local-only";
        }
        cookie.clear(response);
        return ApiResponse.ok(new LogoutResult(outcome));
    }
    /**
     * 为当前用户校验原密码并设置新密码，成功返回 204。
     *
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PutMapping(value = "/password", consumes = MediaType.APPLICATION_JSON_VALUE) ResponseEntity<Void> password(@RequestBody ChangePassword request, HttpServletResponse response) {
        auth.changePassword(CurrentUser.id(), request.currentPassword(), request.newPassword());
        cookie.clear(response);
        return ResponseEntity.noContent().build();
    }
}
