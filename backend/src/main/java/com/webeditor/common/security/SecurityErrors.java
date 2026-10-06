package com.webeditor.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.common.response.ApiError;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

@Component
public class SecurityErrors {
    private final ObjectMapper mapper;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param mapper JSON 序列化器
     */
    public SecurityErrors(ObjectMapper mapper) { this.mapper = mapper; }
    /**
     * 设置状态码、UTF-8 JSON 和禁止缓存响应头，再写入统一认证错误。
     *
     * @param request 当前 HTTP 请求
     * @param response HTTP 响应
     * @param status HTTP 状态码
     * @param code 业务错误码
     */
    public void write(HttpServletRequest request, HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        mapper.writeValue(response.getOutputStream(), ApiError.of(status, code,
                "INVALID_CREDENTIALS".equals(code) ? "用户名或密码错误"
                        : status == 401 ? "需要登录" : status == 403 ? "访问被拒绝" : status == 400 ? "请求参数校验失败"
                        : status == 429 ? "请求过于频繁" : "认证服务暂时不可用", request.getRequestURI()));
    }
}
