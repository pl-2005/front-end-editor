package com.webeditor.project.application;

import com.webeditor.project.domain.Project;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class ProjectResponses {
    private ProjectResponses() {
    }

    public record Summary(
            long id,
            String name,
            String description,
            String template,
            String entry,
            int version,
            Instant createdAt,
            Instant updatedAt
    ) {
        static Summary from(Project project) {
            return new Summary(project.getId(), project.getName(), project.getDescription(), project.getTemplate(),
                    project.getEntryFile(), project.getCurrentVersion(), project.getCreatedAt(), project.getUpdatedAt());
        }
    }

    public record Details(
            long id,
            String name,
            String description,
            String template,
            String entry,
            int version,
            Map<String, SnapshotFile> files,
            Instant createdAt,
            Instant updatedAt
    ) {
        static Details from(Project project, Map<String, SnapshotFile> files) {
            return new Details(project.getId(), project.getName(), project.getDescription(), project.getTemplate(),
                    project.getEntryFile(), project.getCurrentVersion(), files,
                    project.getCreatedAt(), project.getUpdatedAt());
        }
    }

    public record PageResult<T>(List<T> items, int page, int size, long totalElements, int totalPages) {
    }

    public record SnapshotSaved(int version, String contentHash, Instant savedAt) {
    }

    public record Revision(
            int version,
            String contentHash,
            long sizeBytes,
            Instant createdAt,
            boolean current
    ) {
        static Revision from(com.webeditor.project.domain.ProjectRevision revision, int currentVersion) {
            return new Revision(revision.getVersion(), revision.getContentHash(), revision.getSizeBytes(),
                    revision.getCreatedAt(), revision.getVersion() == currentVersion);
        }
    }
}
