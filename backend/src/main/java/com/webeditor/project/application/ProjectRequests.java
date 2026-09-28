package com.webeditor.project.application;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class ProjectRequests {
    private ProjectRequests() {
    }

    public record Create(
            @NotBlank @Size(max = 100) String name,
            @Size(max = 500) String description,
            @Size(max = 30) String template,
            @Size(max = 255) String entry
    ) {
    }

    public record Update(
            @NotBlank @Size(max = 100) String name,
            @Size(max = 500) String description,
            @Size(max = 30) String template
    ) {
    }
}
