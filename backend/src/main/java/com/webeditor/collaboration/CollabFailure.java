package com.webeditor.collaboration;

public class CollabFailure extends RuntimeException {
    private final int status;
    private final String code;
    private Long initializingProjectId;
    /**
     * 创建业务异常并保留错误说明、状态或原始原因。
     *
     * @param status HTTP 状态码
     * @param code 业务错误码
     */
    public CollabFailure(int status, String code) {
        super(code); this.status = status; this.code = code;
    }
    /**
     * 返回该业务异常对应的 HTTP 状态码。
     */
    public int status() { return status; }
    /**
     * 返回客户端可识别的业务错误码。
     */
    public String code() { return code; }
    /**
     * 返回初始化失败时预留的项目 ID；其他错误返回 null。
     */
    public Long initializingProjectId() { return initializingProjectId; }
    /**
     * 包装初始化失败原因并携带已预留的项目 ID，供客户端重试同一项目。
     *
     * @param id 项目 ID
     * @param cause 原始异常原因
     */
    public static CollabFailure initialization(long id, RuntimeException cause) {
        CollabFailure failure = new CollabFailure(503, "COLLAB_INITIALIZATION_FAILED");
        failure.initializingProjectId = id;
        failure.initCause(cause);
        return failure;
    }
    /**
     * 创建表示协作文档指针或二进制对象损坏的 503 异常。
     */
    public static CollabFailure corrupt() { return new CollabFailure(503, "COLLAB_STORAGE_CORRUPT"); }
}
