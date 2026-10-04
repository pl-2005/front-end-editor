package com.webeditor.project.application;

import com.webeditor.common.exception.InvalidSnapshotException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class SnapshotValidator {
    static final int MAX_FILES = 100;
    static final int MAX_FILE_BYTES = 1024 * 1024;
    static final int MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("html", "css", "js", "json", "txt", "md");

    /**
     * 校验入口存在、文件路径、允许类型、文件数和 UTF-8 内容大小，拒绝无效快照。
     *
     * @param entry 入口文件绝对路径
     * @param files 文件集合
     */
    public void validate(String entry, Map<String, SnapshotFile> files) {
        validatePath(entry);
        if (files.size() > MAX_FILES) {
            throw new InvalidSnapshotException("单个项目最多包含 100 个文件");
        }
        if (!files.containsKey(entry)) {
            throw new InvalidSnapshotException("入口文件必须存在于文件集合中");
        }

        long totalBytes = 0;
        for (var item : files.entrySet()) {
            validatePath(item.getKey());
            if (item.getValue() == null || item.getValue().code() == null) {
                throw new InvalidSnapshotException("文件内容不能为空");
            }
            int bytes = item.getValue().code().getBytes(StandardCharsets.UTF_8).length;
            if (bytes > MAX_FILE_BYTES) {
                throw new InvalidSnapshotException("单个文件不能超过 1 MB: " + item.getKey());
            }
            totalBytes += bytes;
            if (totalBytes > MAX_SNAPSHOT_BYTES) {
                throw new InvalidSnapshotException("未压缩快照不能超过 10 MB");
            }
        }
    }

    /**
     * 校验绝对文件路径及扩展名，拒绝空段、路径穿越、反斜杠和空字符。
     *
     * @param path 目标路径
     */
    public void validatePath(String path) {
        if (path == null || path.length() > 255 || !path.startsWith("/") || path.length() < 2 || path.contains("\\")
                || path.indexOf('\0') >= 0 || path.contains("//")) {
            throw new InvalidSnapshotException("文件路径格式无效: " + path);
        }
        for (String segment : path.substring(1).split("/", -1)) {
            if (segment.isBlank() || segment.equals(".") || segment.equals("..")) {
                throw new InvalidSnapshotException("文件路径格式无效: " + path);
            }
        }
        int dot = path.lastIndexOf('.');
        String extension = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new InvalidSnapshotException("不支持的文件类型: " + path);
        }
    }

    /**
     * 校验包含 JSON 结构开销的未压缩快照大小不超过 10 MiB。
     *
     * @param bytes 字节数
     */
    public void validateEncodedSize(int bytes) {
        if (bytes > MAX_SNAPSHOT_BYTES) {
            throw new InvalidSnapshotException("未压缩快照不能超过 10 MB");
        }
    }
}
