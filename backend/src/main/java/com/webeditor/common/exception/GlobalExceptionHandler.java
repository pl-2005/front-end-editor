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
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(TeamFailure.class)
    ResponseEntity<ApiError> handleTeamFailure(TeamFailure exception, HttpServletRequest request) {
        return ResponseEntity.status(exception.status()).body(ApiError.of(exception.status(), exception.code(),
                exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(RedisConnectionFailureException.class)
    ResponseEntity<ApiError> handleRedisFailure(HttpServletRequest request) {
        return ResponseEntity.status(503).body(ApiError.of(503, "AUTH_SERVICE_UNAVAILABLE",
                "认证服务暂时不可用", request.getRequestURI()));
    }

    @ExceptionHandler(AuthRateLimiter.Limited.class)
    ResponseEntity<ApiError> handleRateLimit(AuthRateLimiter.Limited exception, HttpServletRequest request) {
        return ResponseEntity.status(429).header("Retry-After", Long.toString(exception.retryAfter()))
                .body(ApiError.of(429, "AUTH_RATE_LIMITED", "请求过于频繁", request.getRequestURI()));
    }

    @ExceptionHandler(AuthFailure.class)
    ResponseEntity<ApiError> handleAuthFailure(AuthFailure exception, HttpServletRequest request) {
        return ResponseEntity.status(exception.status()).body(ApiError.of(exception.status(), exception.code(),
                exception.status() == 401 ? "需要登录" : "请求冲突", request.getRequestURI()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiError> handleInvalidInput(IllegalArgumentException exception, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "VALIDATION_FAILED", exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception, HttpServletRequest request) {
        List<FieldViolation> violations = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new FieldViolation(error.getField(), error.getDefaultMessage()))
                .toList();
        ApiError body = new ApiError(Instant.now(), 400, "VALIDATION_FAILED",
                "请求参数校验失败", request.getRequestURI(), violations);
        return ResponseEntity.badRequest().body(body);
    }

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

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadable(HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "INVALID_REQUEST_BODY",
                "请求正文格式无效", request.getRequestURI()));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNotFound(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, "NOT_FOUND",
                "请求的资源不存在", request.getRequestURI()));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> handleMethodNotAllowed(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(ApiError.of(405, "METHOD_NOT_ALLOWED",
                "请求方法不受支持", request.getRequestURI()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiError> handleResponseStatus(ResponseStatusException exception, HttpServletRequest request) {
        HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
        String message = exception.getReason() == null ? status.getReasonPhrase() : exception.getReason();
        return ResponseEntity.status(status).body(ApiError.of(status.value(), status.name(), message,
                request.getRequestURI()));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ApiError> handleResourceNotFound(ResourceNotFoundException exception,
                                                     HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, "PROJECT_NOT_FOUND",
                exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(RevisionNotFoundException.class)
    ResponseEntity<ApiError> handleRevisionNotFound(RevisionNotFoundException exception,
                                                     HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, "REVISION_NOT_FOUND",
                exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(VersionConflictException.class)
    ResponseEntity<ApiError> handleVersionConflict(VersionConflictException exception,
                                                    HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, "VERSION_CONFLICT",
                exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(ProjectStateConflictException.class)
    ResponseEntity<ApiError> handleProjectStateConflict(ProjectStateConflictException exception,
                                                         HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, "PROJECT_STATE_CONFLICT",
                exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    ResponseEntity<ApiError> handleOptimisticLock(ObjectOptimisticLockingFailureException exception,
                                                  HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, "PROJECT_STATE_CONFLICT",
                "项目状态已被并发修改，请刷新后重试", request.getRequestURI()));
    }

    @ExceptionHandler(InvalidSnapshotException.class)
    ResponseEntity<ApiError> handleInvalidSnapshot(InvalidSnapshotException exception,
                                                    HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "INVALID_SNAPSHOT",
                exception.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(StorageException.class)
    ResponseEntity<ApiError> handleStorageFailure(StorageException exception, HttpServletRequest request) {
        log.error("Snapshot storage failure", exception);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ApiError.of(503, "STORAGE_UNAVAILABLE",
                "项目存储暂时不可用", request.getRequestURI()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception, HttpServletRequest request) {
        log.error("Unhandled request failure", exception);
        return ResponseEntity.internalServerError().body(ApiError.of(500, "INTERNAL_ERROR",
                "服务暂时不可用", request.getRequestURI()));
    }
}
