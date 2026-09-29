package com.webeditor.common.security;

import org.springframework.security.core.context.SecurityContextHolder;

public final class CurrentUser {
    private CurrentUser() {}
    public static long id() {
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (!(principal instanceof Long id)) throw new IllegalStateException("Authenticated user missing");
        return id;
    }
}
