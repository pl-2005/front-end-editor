package com.webeditor.common.security;

import org.springframework.security.core.context.SecurityContextHolder;

public final class CurrentUser {
    /**
     * 禁止外部实例化此工具类。
     */
    private CurrentUser() {}
    /**
     * 从 Spring Security 上下文读取当前用户 ID；主体不是 Long 时抛出状态异常。
     */
    public static long id() {
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (!(principal instanceof Long id)) throw new IllegalStateException("Authenticated user missing");
        return id;
    }
}
