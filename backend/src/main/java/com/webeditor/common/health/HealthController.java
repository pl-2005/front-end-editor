package com.webeditor.common.health;

import com.webeditor.common.response.ApiResponse;
import java.time.Instant;
import javax.sql.DataSource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
public class HealthController {
    private final DataSource dataSource;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param dataSource 数据库连接池
     */
    public HealthController(DataSource dataSource) { this.dataSource = dataSource; }
    /**
     * 返回进程存活状态及当前时间，不检查外部依赖。
     */
    @GetMapping
    ApiResponse<HealthResponse> health() {
        return ApiResponse.ok(new HealthResponse("UP", Instant.now()));
    }

    /**
     * 通过数据库连接有效性判断就绪状态；检查失败时返回 503。
     */
    @GetMapping("/readiness")
    ResponseEntity<ApiResponse<HealthResponse>> readiness() {
        try (var connection = dataSource.getConnection()) {
            if (connection.isValid(2)) return ResponseEntity.ok(ApiResponse.ok(new HealthResponse("UP", Instant.now())));
        } catch (Exception ignored) { }
        return ResponseEntity.status(503).body(new ApiResponse<>(Instant.now(), 503, "NOT_READY", "服务尚未就绪",
                new HealthResponse("DOWN", Instant.now())));
    }

    record HealthResponse(String status, Instant timestamp) {
    }
}
