package com.webeditor.identity.application;

public class AuthFailure extends RuntimeException {
    private final int status;
    private final String code;
    /**
     * 创建业务异常并保留错误说明、状态或原始原因。
     *
     * @param status HTTP 状态码
     * @param code 业务错误码
     */
    public AuthFailure(int status, String code) { super(code); this.status = status; this.code = code; }
    /**
     * 返回该业务异常对应的 HTTP 状态码。
     */
    public int status() { return status; }
    /**
     * 返回客户端可识别的业务错误码。
     */
    public String code() { return code; }
}
