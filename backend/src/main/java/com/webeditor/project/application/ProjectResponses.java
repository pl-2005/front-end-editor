package com.webeditor.project.application;

import com.webeditor.project.domain.Project;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class ProjectResponses {
    /**
     * 禁止外部实例化此工具类。
     */
    private ProjectResponses() {
    }

    public record Summary(
            long id,
            String name,
            String description,
            String template,
            String entry,
            int version,
            long stateVersion,
            Instant createdAt,
            Instant updatedAt
    ) {
        /**
         * 将项目实体转换为公开摘要，包含元数据状态版本及审计时间。
         *
         * @param project 项目实体或摘要
         */
        public static Summary from(Project project) {
            return new Summary(project.getId(), project.getName(), project.getDescription(), project.getTemplate(),
                    project.getEntryFile(), project.getCurrentVersion(), project.getLockVersion(), project.getCreatedAt(), project.getUpdatedAt());
        }
    }

    public record Details(
            long id,
            String name,
            String description,
            String template,
            String entry,
            int version,
            long stateVersion,
            Map<String, SnapshotFile> files,
            Instant createdAt,
            Instant updatedAt
    ) {
        /**
         * 组合项目元数据和当前快照文件，生成项目详情响应。
         *
         * @param project 项目实体或摘要
         * @param files 文件集合
         */
        static Details from(Project project, Map<String, SnapshotFile> files) {
            return new Details(project.getId(), project.getName(), project.getDescription(), project.getTemplate(),
                    project.getEntryFile(), project.getCurrentVersion(), project.getLockVersion(), files,
                    project.getCreatedAt(), project.getUpdatedAt());
        }
    }

    public record PageResult<T>(List<T> items, int page, int size, long totalElements, int totalPages) {
    }

    public record SnapshotSaved(int version, long stateVersion, String contentHash, Instant savedAt) {
    }

    public record Revision(
            int version,
            String contentHash,
            long sizeBytes,
            Instant createdAt,
            boolean current
    ) {
        /**
         * 将修订实体转换为历史版本视图，并标记是否为当前版本。
         *
         * @param revision 快照修订记录
         * @param currentVersion 当前快照版本号
         */
        static Revision from(com.webeditor.project.domain.ProjectRevision revision, int currentVersion) {
            return new Revision(revision.getVersion(), revision.getContentHash(), revision.getSizeBytes(),
                    revision.getCreatedAt(), revision.getVersion() == currentVersion);
        }
    }
}
