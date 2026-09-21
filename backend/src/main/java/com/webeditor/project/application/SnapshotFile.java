package com.webeditor.project.application;

import jakarta.validation.constraints.NotNull;

public record SnapshotFile(@NotNull String code) {
}
