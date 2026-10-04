package com.webeditor.collaboration;

import com.webeditor.storage.MinioProperties;
import com.webeditor.storage.StorageException;
import io.minio.*;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class MinioCollabObjectStorage implements CollabObjectStorage {
    private final MinioClient client;
    private final MinioProperties properties;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param client MinIO 客户端
     * @param properties MinIO 存储配置
     */
    public MinioCollabObjectStorage(MinioClient client, MinioProperties properties) {
        this.client = client; this.properties = properties;
    }
    /**
     * 严格校验对象键属于协作文档命名空间，防止访问其他存储对象。
     *
     * @param key 协作文档存储对象键
     */
    private void namespace(String key) {
        if (!key.matches("collab/projects/[1-9][0-9]*/epochs/[1-9][0-9]*/[1-9][0-9]*-[a-f0-9]{64}\\.yjs"))
            throw CollabFailure.corrupt();
    }
    /**
     * 校验命名空间并以协作二进制内容类型上传 MinIO 对象。
     *
     * @param key 协作文档存储对象键
     * @param bytes 文档二进制内容
     */
    public void put(String key, byte[] bytes) {
        namespace(key);
        try (var input = new ByteArrayInputStream(bytes)) {
            client.putObject(PutObjectArgs.builder().bucket(properties.bucket()).object(key)
                    .stream(input, bytes.length, -1).contentType(CollabPointer.CONTENT_TYPE).build());
        } catch (Exception e) { throw new StorageException("Collaboration upload unavailable"); }
    }
    /**
     * 限量读取协作文档对象；空对象、超限或对象缺失均视为存储损坏。
     *
     * @param key 协作文档存储对象键
     */
    public byte[] get(String key) {
        namespace(key);
        try (var input = client.getObject(GetObjectArgs.builder().bucket(properties.bucket()).object(key).build())) {
            byte[] bytes = input.readNBytes(CollabPointer.MAX_BYTES + 1);
            if (bytes.length == 0 || bytes.length > CollabPointer.MAX_BYTES) throw CollabFailure.corrupt();
            return bytes;
        } catch (CollabFailure e) { throw e; }
        catch (io.minio.errors.ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) throw CollabFailure.corrupt();
            throw new StorageException("Collaboration read unavailable");
        } catch (Exception e) { throw new StorageException("Collaboration read unavailable"); }
    }
    /**
     * 递归列出 collab/ 命名空间内的对象及修改时间。
     */
    public List<ObjectInfo> list() {
        try {
            List<ObjectInfo> objects = new ArrayList<>();
            for (var result : client.listObjects(ListObjectsArgs.builder().bucket(properties.bucket()).prefix("collab/").recursive(true).build())) {
                var item = result.get(); objects.add(new ObjectInfo(item.objectName(), item.lastModified().toInstant()));
            }
            return objects;
        } catch (Exception e) { throw new StorageException("Collaboration listing unavailable"); }
    }
    /**
     * 校验协作对象键后删除 MinIO 对象。
     *
     * @param key 协作文档存储对象键
     */
    public void delete(String key) {
        namespace(key);
        try { client.removeObject(RemoveObjectArgs.builder().bucket(properties.bucket()).object(key).build()); }
        catch (Exception e) { throw new StorageException("Collaboration cleanup unavailable"); }
    }
}
