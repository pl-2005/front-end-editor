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

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param client MinIO 客户端
     * @param properties MinIO 存储配置
     */
    public MinioSnapshotStorage(MinioClient client, MinioProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    /**
     * 将 gzip 快照上传到配置的 MinIO 桶，上传失败转换为存储异常。
     *
     * @param objectKey 存储对象键
     * @param content 待存储内容
     */
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

    /**
     * 流式读取快照对象并限制压缩内容不超过 12 MiB。
     *
     * @param objectKey 存储对象键
     */
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

    /**
     * 删除指定快照对象，存储失败转换为存储异常。
     *
     * @param objectKey 存储对象键
     */
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

    /**
     * 递归列出给定前缀下的快照对象及最后修改时间。
     *
     * @param prefix 存储对象前缀
     */
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
