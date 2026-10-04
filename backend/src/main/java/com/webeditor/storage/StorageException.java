package com.webeditor.storage;

public class StorageException extends RuntimeException {
    /**
     * 创建业务异常并保留错误说明、状态或原始原因。
     *
     * @param message 错误或业务说明
     */
    public StorageException(String message) {
        super(message);
    }

    /**
     * 创建业务异常并保留错误说明、状态或原始原因。
     *
     * @param message 错误或业务说明
     * @param cause 原始异常原因
     */
    public StorageException(String message, Throwable cause) {
        super(message, cause);
    }
}
