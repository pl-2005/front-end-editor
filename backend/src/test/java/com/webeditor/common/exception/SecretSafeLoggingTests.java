package com.webeditor.common.exception;

import com.webeditor.collaboration.CollabMetrics;
import com.webeditor.storage.StorageException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class SecretSafeLoggingTests {
    @Test void exceptionMessagesAndCausesCannotEnterRequestLogs(CapturedOutput output) {
        var handler = new GlobalExceptionHandler(new CollabMetrics());
        var request = new MockHttpServletRequest(); request.setAttribute("requestId", "safe-request-id");
        String marker = "password-jwt-ticket-source-must-never-be-logged";
        handler.handleStorageFailure(new StorageException(marker), request);
        handler.handleUnexpected(new IllegalStateException(marker, new RuntimeException(marker)), request);
        assertThat(output.getAll()).contains("safe-request-id", "STORAGE_UNAVAILABLE", "INTERNAL_ERROR").doesNotContain(marker);
    }
}
