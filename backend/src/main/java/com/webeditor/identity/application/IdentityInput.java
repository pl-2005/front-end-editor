package com.webeditor.identity.application;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;

public final class IdentityInput {
    /**
     * 禁止外部实例化此工具类。
     */
    private IdentityInput() {}
    /**
     * 去除首尾空白并做 NFKC 及大小写规范化，按 Unicode 码点校验非空和长度。
     *
     * @param value 待规范化或处理的文本
     * @param max 允许的最大 Unicode 码点数
     * @return 经过 NFKC 及小写规范化的非空输入
     */
    public static String normalize(String value, int max) {
        if (value == null) throw new IllegalArgumentException("必填字段缺失");
        String result = Normalizer.normalize(value.trim(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        if (result.isBlank() || result.codePointCount(0, result.length()) > max)
            throw new IllegalArgumentException("字段长度无效");
        return result;
    }
    /**
     * 校验密码为 10–64 个 Unicode 码点且 UTF-8 不超过 72 字节，满足密码编码器限制。
     *
     * @param password 密码明文，仅用于校验或编码
     */
    public static void validatePassword(String password) {
        if (password == null || password.codePointCount(0, password.length()) < 10
                || password.codePointCount(0, password.length()) > 64
                || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("密码长度须为 10–64 个字符且 UTF-8 不超过 72 字节");
    }
}
