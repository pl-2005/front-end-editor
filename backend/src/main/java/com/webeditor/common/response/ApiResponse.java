package com.webeditor.common.response;

import java.time.Instant;

public record ApiResponse<T>(
        Instant timestamp,
        int status,
        String code,
        String message,
        T data
) {
    /**
     * 将业务数据包装为状态码 200 的统一成功响应。
     *
     * @param data 业务响应数据
     */
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(Instant.now(), 200, "OK", "请求成功", data);
    }

    /**
     * 将新建资源包装为状态码 201 的统一创建响应。
     *
     * @param data 业务响应数据
     */
    public static <T> ApiResponse<T> created(T data) {
        return new ApiResponse<>(Instant.now(), 201, "CREATED", "创建成功", data);
    }
}
