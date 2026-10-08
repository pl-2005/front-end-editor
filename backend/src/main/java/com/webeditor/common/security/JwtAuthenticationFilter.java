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
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param decoder JWT 签名解码器
     * @param users 用户仓储
     * @param errors 统一认证错误写入器
     * @param issuer JWT 签发方
     * @param audience 内部请求或令牌的受众标识
     */
    public JwtAuthenticationFilter(JwtDecoder decoder, AppUserRepository users, SecurityErrors errors,
            @Value("${editor.auth.issuer}") String issuer, @Value("${editor.auth.audience}") String audience) {
        this.decoder = decoder; this.users = users; this.errors = errors;
        this.issuer = issuer; this.audience = audience;
    }
    /**
     * 跳过非 API、预检及公开接口，其余 API 请求必须验证访问令牌。
     *
     * @param request 当前 HTTP 请求
     */
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        String method = request.getMethod();
        return !path.startsWith("/api/") || "OPTIONS".equals(method)
                || "POST".equals(method) && (path.equals("/api/auth/register") || path.equals("/api/auth/login") || path.equals("/api/auth/refresh") || path.equals("/api/auth/logout"))
                || "GET".equals(method) && (path.equals("/api/health") || path.equals("/api/health/readiness") || path.equals("/api/teams/discover"));
    }
    /**
     * 验证唯一 Bearer 令牌、JWT 声明和用户令牌版本，设置用户主体供后续处理，并在结束时清理上下文。
     *
     * @param request 当前 HTTP 请求
     * @param response HTTP 响应
     * @param chain 后续过滤器链
     */
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
        } catch (org.springframework.dao.DataAccessException | org.springframework.transaction.TransactionException exception) {
            errors.write(request, response, 503, "AUTH_SERVICE_UNAVAILABLE");
            return;
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
