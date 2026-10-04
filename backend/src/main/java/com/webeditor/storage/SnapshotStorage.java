package com.webeditor.storage;

import java.time.Instant;
import java.util.List;

public interface SnapshotStorage {
    /**
     * 存储指定对象键对应的压缩快照内容。
     *
     * @param objectKey 存储对象键
     * @param content 待存储内容
     */
    void put(String objectKey, byte[] content);

    /**
     * 读取指定对象键对应的压缩快照内容。
     *
     * @param objectKey 存储对象键
     */
    byte[] get(String objectKey);

    /**
     * 删除指定快照对象。
     *
     * @param objectKey 存储对象键
     */
    void delete(String objectKey);

    /**
     * 列出指定前缀下的对象；默认实现返回空列表，表示不提供枚举能力。
     *
     * @param prefix 存储对象前缀
     */
    default List<StoredObject> list(String prefix) {
        return List.of();
    }

    record StoredObject(String key, Instant lastModified) {
    }
}
