package com.webeditor.project.application;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.storage.StorageException;
import java.io.ByteArrayOutputStream;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;

class SnapshotCodecTests {
    private final SnapshotCodec codec = new SnapshotCodec(new ObjectMapper());

    @Test
    void rejectsCorruptGzipData() {
        assertThatThrownBy(() -> codec.decode(new byte[]{1, 2, 3}))
                .isInstanceOf(StorageException.class);
    }

    @Test
    void rejectsCompressedObjectsAboveLimit() {
        assertThatThrownBy(() -> codec.decode(new byte[12 * 1024 * 1024 + 1]))
                .isInstanceOf(StorageException.class);
    }

    @Test
    void rejectsGzipExpansionAboveLimit() throws Exception {
        byte[] expanded = new byte[10 * 1024 * 1024 + 1];
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(compressed)) {
            gzip.write(expanded);
        }

        assertThatThrownBy(() -> codec.decode(compressed.toByteArray()))
                .isInstanceOf(StorageException.class)
                .hasMessageContaining("decompressed size limit");
    }
}
