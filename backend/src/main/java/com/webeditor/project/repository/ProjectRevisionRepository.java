package com.webeditor.project.repository;

import com.webeditor.project.domain.ProjectRevision;
import java.util.Optional;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectRevisionRepository extends JpaRepository<ProjectRevision, Long> {
    Optional<ProjectRevision> findByProjectIdAndVersion(Long projectId, int version);

    List<ProjectRevision> findAllByProjectIdOrderByVersionDesc(Long projectId);

    boolean existsByObjectKey(String objectKey);
}
