package com.webeditor.common.exception;

public class RevisionNotFoundException extends RuntimeException {
    /**
     * 创建业务异常并保留错误说明、状态或原始原因。
     *
     * @param message 错误或业务说明
     */
    public RevisionNotFoundException(String message) {
        super(message);
    }
}
