package com.webeditor.collaboration;

import java.time.Instant;
import java.util.List;

public interface CollabObjectStorage {
    /**
     * 将协作文档二进制写入指定对象键。
     *
     * @param key 协作文档存储对象键
     * @param bytes 文档二进制内容
     */
    void put(String key, byte[] bytes);
    /**
     * 读取指定对象键对应的协作文档二进制。
     *
     * @param key 协作文档存储对象键
     */
    byte[] get(String key);
    /**
     * 列出协作文档存储对象及修改时间，供孤儿清理使用。
     */
    List<ObjectInfo> list();
    /**
     * 删除指定协作文档对象；调用方负责确认对象已不再被引用。
     *
     * @param key 协作文档存储对象键
     */
    void delete(String key);
    record ObjectInfo(String key, Instant modifiedAt) {}
}
