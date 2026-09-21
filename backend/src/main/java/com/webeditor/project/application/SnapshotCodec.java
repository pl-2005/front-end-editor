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
    private final ObjectMapper objectMapper;

    public SnapshotCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

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

    public SnapshotDocument decode(byte[] compressed) {
        try (var gzip = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
            return objectMapper.readValue(gzip.readAllBytes(), SnapshotDocument.class);
        } catch (IOException exception) {
            throw new StorageException("Could not decode project snapshot", exception);
        }
    }

    public record EncodedSnapshot(String hash, byte[] compressed, int uncompressedBytes) {
    }
}
