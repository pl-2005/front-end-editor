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
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param errors 统一认证错误写入器
     */
    public AuthJsonBodyLimitFilter(SecurityErrors errors) { this.errors = errors; }
    /**
     * 仅对注册、登录、刷新令牌和修改密码接口启用请求体大小限制。
     *
     * @param request 当前 HTTP 请求
     */
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !(request.getMethod().equals("POST") && (request.getRequestURI().equals("/api/auth/login")
                || request.getRequestURI().equals("/api/auth/register") || request.getRequestURI().equals("/api/auth/refresh")))
                && !(request.getMethod().equals("PUT") && request.getRequestURI().equals("/api/auth/password"));
    }
    /**
     * 限量读取认证请求体并拒绝超过 8 KiB 的内容，再包装可重新读取的请求交给后续过滤器。
     *
     * @param request 当前 HTTP 请求
     * @param response HTTP 响应
     * @param chain 后续过滤器链
     */
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
            /**
             * 从已缓存的请求体创建新的输入流，允许后续过滤器重新读取。
             */
            @Override public ServletInputStream getInputStream() {
                ByteArrayInputStream input = new ByteArrayInputStream(body);
                return new ServletInputStream() {
                    /**
                     * 返回缓存请求体是否已读取完毕。
                     */
                    @Override public boolean isFinished() { return input.available() == 0; }
                    /**
                     * 内存输入流可立即读取，始终返回 true。
                     */
                    @Override public boolean isReady() { return true; }
                    /**
                     * 拒绝异步读取监听，此内存请求包装器仅支持同步读取。
                     *
                     * @param listener 状态或读取监听器
                     */
                    @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                    /**
                     * 读取缓存请求体的下一个字节，到达末尾时返回 -1。
                     */
                    @Override public int read() { return input.read(); }
                };
            }
            /**
             * 以 UTF-8 将缓存请求体包装为字符读取器。
             */
            @Override public BufferedReader getReader() {
                return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
            }
        }, response);
    }
}
