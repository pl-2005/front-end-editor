package com.webeditor.project.application;

import static org.junit.jupiter.api.Assertions.assertThrows;

import com.webeditor.common.exception.InvalidSnapshotException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SnapshotValidatorTests {
    private final SnapshotValidator validator = new SnapshotValidator();

    @Test
    void rejectsFilesLargerThanOneMegabyte() {
        Map<String, SnapshotFile> files = Map.of(
                "/index.html", new SnapshotFile("x".repeat(1024 * 1024 + 1)));

        assertThrows(InvalidSnapshotException.class, () -> validator.validate("/index.html", files));
    }

    @Test
    void rejectsMoreThanOneHundredFiles() {
        Map<String, SnapshotFile> files = new LinkedHashMap<>();
        files.put("/index.html", new SnapshotFile("entry"));
        for (int index = 0; index < 100; index++) {
            files.put("/file-" + index + ".js", new SnapshotFile(""));
        }

        assertThrows(InvalidSnapshotException.class, () -> validator.validate("/index.html", files));
    }
}
