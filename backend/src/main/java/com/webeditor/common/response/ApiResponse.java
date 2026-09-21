package com.webeditor.common.response;

import java.time.Instant;

public record ApiResponse<T>(
        Instant timestamp,
        int status,
        String code,
        String message,
        T data
) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(Instant.now(), 200, "OK", "请求成功", data);
    }

    public static <T> ApiResponse<T> created(T data) {
        return new ApiResponse<>(Instant.now(), 201, "CREATED", "创建成功", data);
    }
}
