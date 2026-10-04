package com.webeditor.collaboration;

import com.webeditor.project.domain.Project;
import java.time.Instant;

public final class CollabProjectResponses {
    /**
     * 禁止外部实例化此工具类。
     */
    private CollabProjectResponses() {}
    public record Summary(long id, String name, String description, String template, String entry,
                          long stateVersion, Instant createdAt, Instant updatedAt) {
        /**
         * 将项目实体转换为公开摘要，包含元数据状态版本及审计时间。
         *
         * @param p 项目实体
         */
        public static Summary from(Project p) {
            return new Summary(p.getId(), p.getName(), p.getDescription(), p.getTemplate(), p.getEntryFile(), p.getLockVersion(), p.getCreatedAt(), p.getUpdatedAt());
        }
    }
    // Public metadata never reveals storage keys, legacy versions or source bytes.
    public record Document(String collaborationMode, long epoch, long generation, String contentHash, long size, String contentType) {
        /**
         * 将当前指针转换为 YJS 协作文档元数据响应。
         *
         * @param p 协作文档指针
         */
        public static Document from(CollabPointer p) { return new Document("YJS", p.epoch(), p.generation(), p.contentHash(), p.size(), p.contentType()); }
    }
    public record Details(long id, String name, String description, String template, String entry,
                          long stateVersion, Instant createdAt, Instant updatedAt, Document collaboration) {
        /**
         * 组合项目元数据与当前协作文档指针，生成详情响应。
         *
         * @param p 项目实体
         * @param d 当前协作文档指针
         */
        public static Details from(Project p, CollabPointer d) {
            return new Details(p.getId(), p.getName(), p.getDescription(), p.getTemplate(), p.getEntryFile(), p.getLockVersion(), p.getCreatedAt(), p.getUpdatedAt(), Document.from(d));
        }
    }
}
