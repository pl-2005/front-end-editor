package com.webeditor.project.application;

import jakarta.validation.constraints.Min;

public record RestoreRevisionRequest(@Min(0) int expectedVersion) {
}
