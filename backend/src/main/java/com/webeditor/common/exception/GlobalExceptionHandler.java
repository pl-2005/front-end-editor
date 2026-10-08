package com.webeditor.common.exception;

import com.webeditor.common.response.ApiError;
import com.webeditor.common.response.FieldViolation;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import com.webeditor.storage.StorageException;
import com.webeditor.identity.application.AuthFailure;
import com.webeditor.team.application.TeamFailure;
import com.webeditor.identity.application.AuthRateLimiter;
import org.springframework.data.redis.RedisConnectionFailureException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler({org.springframework.dao.DataAccessException.class, org.springframework.transaction.TransactionException.class})
    ResponseEntity<ApiError> handleDependencyFailure(HttpServletRequest request) {
        return ResponseEntity.status(503).body(ApiError.of(503, "AUTH_SERVICE_UNAVAILABLE", "认证服务暂时不可用", request.getRequestURI()));
    }
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private final com.webeditor.collaboration.CollabMetrics metrics;
    public GlobalExceptionHandler(com.webeditor.collaboration.CollabMetrics metrics) { this.metrics = metrics; }

    /**
     * 转换协作故障为对应状态响应；初始化失败时通过响应头保留可重试项目 ID。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(com.webeditor.collaboration.CollabFailure.class)
    ResponseEntity<ApiError> handleCollabFailure(com.webeditor.collaboration.CollabFailure exception, HttpServletRequest request) {
        var response = ResponseEntity.status(exception.status());
        if (exception.initializingProjectId() != null)
            response.header("X-Initializing-Project", exception.initializingProjectId().toString());
        return response.body(ApiError.of(exception.status(), exception.code(),
                "协作文档操作未完成，请重试或刷新", request.getRequestURI()));
    }

    /**
     * 保留团队业务异常的状态、错误码和说明。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(TeamFailure.class)
    ResponseEntity<ApiError> handleTeamFailure(TeamFailure exception, HttpServletRequest request) {
        return ResponseEntity.status(exception.status()).body(ApiError.of(exception.status(), exception.code(),
                exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 将 Redis 连接故障转换为 503 认证服务不可用。
     *
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(RedisConnectionFailureException.class)
    ResponseEntity<ApiError> handleRedisFailure(HttpServletRequest request) {
        metrics.increment(com.webeditor.collaboration.CollabMetrics.Name.REDIS_FAILURE);
        return ResponseEntity.status(503).body(ApiError.of(503, "AUTH_SERVICE_UNAVAILABLE",
                "认证服务暂时不可用", request.getRequestURI()));
    }

    /**
     * 将限流异常转换为 429 并设置 Retry-After 秒数。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(AuthRateLimiter.Limited.class)
    ResponseEntity<ApiError> handleRateLimit(AuthRateLimiter.Limited exception, HttpServletRequest request) {
        return ResponseEntity.status(429).header("Retry-After", Long.toString(exception.retryAfter()))
                .body(ApiError.of(429, "AUTH_RATE_LIMITED", "请求过于频繁", request.getRequestURI()));
    }

    /**
     * 将认证业务故障转换为统一响应，401 使用需要登录提示。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(AuthFailure.class)
    ResponseEntity<ApiError> handleAuthFailure(AuthFailure exception, HttpServletRequest request) {
        return ResponseEntity.status(exception.status()).body(ApiError.of(exception.status(), exception.code(),
                exception.status() == 401 ? "需要登录" : "请求冲突", request.getRequestURI()));
    }

    /**
     * 将非法业务输入转换为 400 参数校验失败。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiError> handleInvalidInput(IllegalArgumentException exception, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "VALIDATION_FAILED", exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 收集请求体字段校验错误，返回包含字段违规列表的 400 响应。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception, HttpServletRequest request) {
        List<FieldViolation> violations = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new FieldViolation(error.getField(), error.getDefaultMessage()))
                .toList();
        ApiError body = new ApiError(Instant.now(), 400, "VALIDATION_FAILED",
                "请求参数校验失败", request.getRequestURI(), violations);
        return ResponseEntity.badRequest().body(body);
    }

    /**
     * 收集参数约束违规信息，返回包含字段路径的 400 响应。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiError> handleConstraintViolation(ConstraintViolationException exception,
                                                        HttpServletRequest request) {
        List<FieldViolation> violations = exception.getConstraintViolations().stream()
                .map(item -> new FieldViolation(item.getPropertyPath().toString(), item.getMessage()))
                .toList();
        ApiError body = new ApiError(Instant.now(), 400, "VALIDATION_FAILED",
                "请求参数校验失败", request.getRequestURI(), violations);
        return ResponseEntity.badRequest().body(body);
    }

    /**
     * 将不可解析的请求正文转换为 400 格式错误。
     *
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadable(HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "INVALID_REQUEST_BODY",
                "请求正文格式无效", request.getRequestURI()));
    }

    /**
     * 将未找到的路由或静态资源转换为统一 404。
     *
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNotFound(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, "NOT_FOUND",
                "请求的资源不存在", request.getRequestURI()));
    }

    /**
     * 将不支持的 HTTP 方法转换为统一 405。
     *
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> handleMethodNotAllowed(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(ApiError.of(405, "METHOD_NOT_ALLOWED",
                "请求方法不受支持", request.getRequestURI()));
    }

    /**
     * 保留显式 HTTP 状态及说明，包装为统一错误响应。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiError> handleResponseStatus(ResponseStatusException exception, HttpServletRequest request) {
        HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
        String message = exception.getReason() == null ? status.getReasonPhrase() : exception.getReason();
        return ResponseEntity.status(status).body(ApiError.of(status.value(), status.name(), message,
                request.getRequestURI()));
    }

    /**
     * 将项目资源不存在转换为 PROJECT_NOT_FOUND 404。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ApiError> handleResourceNotFound(ResourceNotFoundException exception,
                                                     HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, "PROJECT_NOT_FOUND",
                exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 将快照版本不存在转换为 REVISION_NOT_FOUND 404。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(RevisionNotFoundException.class)
    ResponseEntity<ApiError> handleRevisionNotFound(RevisionNotFoundException exception,
                                                     HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, "REVISION_NOT_FOUND",
                exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 将快照版本冲突转换为 VERSION_CONFLICT 409。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(VersionConflictException.class)
    ResponseEntity<ApiError> handleVersionConflict(VersionConflictException exception,
                                                    HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, "VERSION_CONFLICT",
                exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 将元数据版本冲突转换为 PROJECT_STATE_CONFLICT 409。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(ProjectStateConflictException.class)
    ResponseEntity<ApiError> handleProjectStateConflict(ProjectStateConflictException exception,
                                                         HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, "PROJECT_STATE_CONFLICT",
                exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 将 JPA 乐观锁冲突转换为元数据状态冲突 409。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    ResponseEntity<ApiError> handleOptimisticLock(ObjectOptimisticLockingFailureException exception,
                                                  HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, "PROJECT_STATE_CONFLICT",
                "项目状态已被并发修改，请刷新后重试", request.getRequestURI()));
    }

    /**
     * 将快照内容或路径校验失败转换为 INVALID_SNAPSHOT 400。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(InvalidSnapshotException.class)
    ResponseEntity<ApiError> handleInvalidSnapshot(InvalidSnapshotException exception,
                                                    HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "INVALID_SNAPSHOT",
                exception.getMessage(), request.getRequestURI()));
    }

    /**
     * 记录对象存储故障并返回 503，不向客户端暴露底层异常。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(StorageException.class)
    ResponseEntity<ApiError> handleStorageFailure(StorageException exception, HttpServletRequest request) {
        log.error("STORAGE_UNAVAILABLE requestId={}", request.getAttribute("requestId"));
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ApiError.of(503, "STORAGE_UNAVAILABLE",
                "项目存储暂时不可用", request.getRequestURI()));
    }

    /**
     * 记录未分类异常并返回统一 500，避免暴露内部实现细节。
     *
     * @param exception 待转换的异常
     * @param request 当前 HTTP 请求
     */
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception, HttpServletRequest request) {
        log.error("INTERNAL_ERROR requestId={}", request.getAttribute("requestId"));
        return ResponseEntity.internalServerError().body(ApiError.of(500, "INTERNAL_ERROR",
                "服务暂时不可用", request.getRequestURI()));
    }
}
