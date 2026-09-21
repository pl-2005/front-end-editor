package com.webeditor.project.application;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.Map;

public record SaveSnapshotRequest(
        @PositiveOrZero int expectedVersion,
        @NotBlank String entry,
        @NotNull Map<@NotBlank String, @Valid SnapshotFile> files
) {
}
