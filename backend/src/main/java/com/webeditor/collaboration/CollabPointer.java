package com.webeditor.collaboration;

public record CollabPointer(long projectId, long epoch, long generation, String objectKey,
                           String contentHash, long size, String contentType) {
    public static final String CONTENT_TYPE = "application/octet-stream";
    public static final int MAX_BYTES = 12 * 1024 * 1024;
    /**
     * 按项目、epoch、generation 和内容摘要生成协作文档专用的不可变对象键。
     *
     * @param id 项目 ID
     * @param epoch 文档生命周期编号
     * @param generation 文档持久化代次
     * @param hash 内容 SHA-256 十六进制摘要
     */
    public static String key(long id, long epoch, long generation, String hash) {
        return "collab/projects/%d/epochs/%d/%d-%s.yjs".formatted(id, epoch, generation, hash);
    }
}
