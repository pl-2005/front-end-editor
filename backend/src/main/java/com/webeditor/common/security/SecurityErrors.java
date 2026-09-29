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
    public SecurityErrors(ObjectMapper mapper) { this.mapper = mapper; }
    public void write(HttpServletRequest request, HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        mapper.writeValue(response.getOutputStream(), ApiError.of(status, code,
                status == 401 ? "需要登录" : status == 403 ? "访问被拒绝" : status == 400 ? "请求参数校验失败"
                        : status == 429 ? "请求过于频繁" : "认证服务暂时不可用", request.getRequestURI()));
    }
}
