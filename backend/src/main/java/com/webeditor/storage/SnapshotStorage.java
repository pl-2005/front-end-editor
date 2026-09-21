package com.webeditor.storage;

import java.time.Instant;
import java.util.List;

public interface SnapshotStorage {
    void put(String objectKey, byte[] content);

    byte[] get(String objectKey);

    void delete(String objectKey);

    default List<StoredObject> list(String prefix) {
        return List.of();
    }

    record StoredObject(String key, Instant lastModified) {
    }
}
