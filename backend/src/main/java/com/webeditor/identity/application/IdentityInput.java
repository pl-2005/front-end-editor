package com.webeditor.identity.application;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;

public final class IdentityInput {
    private IdentityInput() {}
    public static String normalize(String value, int max) {
        if (value == null) throw new IllegalArgumentException("必填字段缺失");
        String result = Normalizer.normalize(value.trim(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        if (result.isBlank() || result.codePointCount(0, result.length()) > max)
            throw new IllegalArgumentException("字段长度无效");
        return result;
    }
    public static void validatePassword(String password) {
        if (password == null || password.codePointCount(0, password.length()) < 10
                || password.codePointCount(0, password.length()) > 64
                || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("密码长度须为 10–64 个字符且 UTF-8 不超过 72 字节");
    }
}
