package com.webeditor.storage;

import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.Result;
import io.minio.messages.Item;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class MinioSnapshotStorage implements SnapshotStorage {
    private static final int MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;
    private final MinioClient client;
    private final MinioProperties properties;

    public MinioSnapshotStorage(MinioClient client, MinioProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    @Override
    public void put(String objectKey, byte[] content) {
        try (var input = new ByteArrayInputStream(content)) {
            client.putObject(PutObjectArgs.builder()
                    .bucket(properties.bucket())
                    .object(objectKey)
                    .stream(input, content.length, -1)
                    .contentType("application/gzip")
                    .build());
        } catch (Exception exception) {
            throw new StorageException("Could not upload project snapshot", exception);
        }
    }

    @Override
    public byte[] get(String objectKey) {
        try (var input = client.getObject(GetObjectArgs.builder()
                .bucket(properties.bucket())
                .object(objectKey)
                .build())) {
            var output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_COMPRESSED_BYTES) throw new StorageException("Project snapshot exceeds size limit");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        } catch (StorageException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new StorageException("Could not read project snapshot", exception);
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            client.removeObject(RemoveObjectArgs.builder()
                    .bucket(properties.bucket())
                    .object(objectKey)
                    .build());
        } catch (Exception exception) {
            throw new StorageException("Could not remove orphaned project snapshot", exception);
        }
    }

    @Override
    public List<StoredObject> list(String prefix) {
        try {
            List<StoredObject> objects = new ArrayList<>();
            Iterable<Result<Item>> results = client.listObjects(ListObjectsArgs.builder()
                    .bucket(properties.bucket())
                    .prefix(prefix)
                    .recursive(true)
                    .build());
            for (Result<Item> result : results) {
                Item item = result.get();
                objects.add(new StoredObject(item.objectName(), item.lastModified().toInstant()));
            }
            return objects;
        } catch (Exception exception) {
            throw new StorageException("Could not list project snapshot objects", exception);
        }
    }
}
