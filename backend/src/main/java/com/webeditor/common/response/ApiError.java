package com.webeditor.common.response;

import java.time.Instant;
import java.util.List;

public record ApiError(
        Instant timestamp,
        int status,
        String code,
        String message,
        String path,
        List<FieldViolation> violations
) {
    /**
     * 创建带当前时间和请求路径的统一错误响应，字段违规列表默认为空。
     *
     * @param status HTTP 状态码
     * @param code 业务错误码
     * @param message 错误或业务说明
     * @param path 目标路径
     */
    public static ApiError of(int status, String code, String message, String path) {
        return new ApiError(Instant.now(), status, code, message, path, List.of());
    }
}
