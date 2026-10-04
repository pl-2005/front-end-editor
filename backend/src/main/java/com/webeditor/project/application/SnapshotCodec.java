package com.webeditor.project.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.storage.StorageException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.springframework.stereotype.Component;

@Component
public class SnapshotCodec {
    private static final int MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;
    private static final int MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
    private final ObjectMapper objectMapper;

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param objectMapper JSON 序列化器
     */
    public SnapshotCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 按路径排序文件并序列化为 JSON，计算未压缩内容 SHA-256 后 gzip 压缩，返回摘要、压缩字节和原始大小。
     *
     * @param entry 入口文件绝对路径
     * @param files 文件集合
     * @return 包含内容摘要、gzip 字节及未压缩大小的编码结果
     */
    public EncodedSnapshot encode(String entry, Map<String, SnapshotFile> files) {
        try {
            SnapshotDocument document = new SnapshotDocument(entry, new TreeMap<>(files));
            byte[] json = objectMapper.writeValueAsBytes(document);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String hash = HexFormat.of().formatHex(digest.digest(json));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (GZIPOutputStream gzip = new GZIPOutputStream(output)) {
                gzip.write(json);
            }
            return new EncodedSnapshot(hash, output.toByteArray(), json.length);
        } catch (JsonProcessingException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Could not encode snapshot", exception);
        } catch (IOException exception) {
            throw new StorageException("Could not compress project snapshot", exception);
        }
    }

    /**
     * 限制压缩及解压大小后解析 gzip JSON 快照，格式错误或超限转换为存储异常。
     *
     * @param compressed gzip 压缩快照字节
     * @return 解压并解析后的快照文档
     */
    public SnapshotDocument decode(byte[] compressed) {
        if (compressed == null || compressed.length > MAX_COMPRESSED_BYTES) {
            throw new StorageException("Project snapshot exceeds compressed size limit");
        }
        try (var gzip = new GZIPInputStream(new ByteArrayInputStream(compressed));
             var output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = gzip.read(buffer)) != -1) {
                total += count;
                if (total > MAX_UNCOMPRESSED_BYTES) {
                    throw new StorageException("Project snapshot exceeds decompressed size limit");
                }
                output.write(buffer, 0, count);
            }
            return objectMapper.readValue(output.toByteArray(), SnapshotDocument.class);
        } catch (StorageException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new StorageException("Could not decode project snapshot", exception);
        }
    }

    public record EncodedSnapshot(String hash, byte[] compressed, int uncompressedBytes) {
    }
}
