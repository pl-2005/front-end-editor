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
    public HealthController(DataSource dataSource) { this.dataSource = dataSource; }
    @GetMapping
    ApiResponse<HealthResponse> health() {
        return ApiResponse.ok(new HealthResponse("UP", Instant.now()));
    }

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
