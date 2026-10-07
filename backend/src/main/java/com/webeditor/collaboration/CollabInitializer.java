package com.webeditor.collaboration;

import java.util.List;

public interface CollabInitializer {
    /**
     * 将入口和初始文件编码为指定项目的 Yjs 二进制文档。
     *
     * @param projectId 项目 ID
     * @param entry 入口文件绝对路径
     * @param files 文件集合
     */
    byte[] initialize(long projectId, String entry, List<FileInput> files);
    /**
     * 从源文档生成目标项目的独立 Yjs 文档，避免复用源文档身份。
     *
     * @param projectId 项目 ID
     * @param source 源协作文档指针
     * @param bytes 文档二进制内容
     */
    byte[] copy(long projectId, CollabPointer source, byte[] bytes);
    byte[] rebuild(CollabPointer source, long epoch, byte[] bytes);
    record FileInput(String path, String code) {}
}
