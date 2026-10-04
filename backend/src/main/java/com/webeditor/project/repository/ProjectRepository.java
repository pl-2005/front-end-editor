package com.webeditor.project.repository;

import com.webeditor.project.domain.Project;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    /**
     * 以悲观写锁读取任意状态的项目，用于初始化激活或备份协调。
     *
     * @param id 项目 ID
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.id = :id")
    Optional<Project> findByIdForUpdate(@Param("id") long id);
    /**
     * 按项目、团队和状态查询已归属的项目，排除遗留无主记录。
     *
     * @param id 项目 ID
     * @param teamId 团队 ID
     * @param status 目标业务状态
     */
    Optional<Project> findByIdAndTeamIdAndStatusAndLegacyUnownedFalse(long id, long teamId, byte status);
    /**
     * 分页查询用户作为有效团队成员可见的有效项目，排除遗留无主记录。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param pageable 分页及排序条件
     */
    @Query("select p from Project p join TeamMember m on m.teamId = p.teamId where m.userId = :userId and m.status = 'ACTIVE' and p.teamId = :teamId and p.status = 1 and p.legacyUnowned = false")
    Page<Project> findVisible(@Param("teamId") long teamId, @Param("userId") long userId, Pageable pageable);
    /**
     * 按状态分页查询项目。
     *
     * @param status 目标业务状态
     * @param pageable 分页及排序条件
     */
    Page<Project> findAllByStatus(byte status, Pageable pageable);

    /**
     * 按项目 ID 和状态查询项目，不存在时返回空 Optional。
     *
     * @param id 项目 ID
     * @param status 目标业务状态
     */
    Optional<Project> findByIdAndStatus(Long id, byte status);

    /**
     * 以悲观写锁读取有效项目，串行化快照或协作文档提交。
     *
     * @param id 项目 ID
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.id = :id and p.status = 1")
    Optional<Project> findActiveByIdForUpdate(@Param("id") Long id);
}
