package com.webeditor.project.repository;

import com.webeditor.project.domain.ProjectRevision;
import java.util.Optional;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectRevisionRepository extends JpaRepository<ProjectRevision, Long> {
    /**
     * 按项目及版本号查询快照修订。
     *
     * @param projectId 项目 ID
     * @param version 版本号
     */
    Optional<ProjectRevision> findByProjectIdAndVersion(Long projectId, int version);

    /**
     * 查询项目全部快照修订，按版本号倒序排列。
     *
     * @param projectId 项目 ID
     */
    List<ProjectRevision> findAllByProjectIdOrderByVersionDesc(Long projectId);

    /**
     * 检查对象键是否仍被快照修订引用，供孤儿清理判断。
     *
     * @param objectKey 存储对象键
     */
    boolean existsByObjectKey(String objectKey);
}
