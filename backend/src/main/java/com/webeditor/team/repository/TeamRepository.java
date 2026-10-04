package com.webeditor.team.repository;

import com.webeditor.team.domain.Team;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TeamRepository extends JpaRepository<Team, Long> {
    /**
     * 以悲观写锁读取 ACTIVE 团队，协调成员、邀请及所有权变更。
     *
     * @param id 团队 ID
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Team t where t.id = :id and t.status = 'ACTIVE'")
    Optional<Team> lockActive(@Param("id") long id);
    /**
     * 分页查询名称匹配且允许申请的 ACTIVE 团队。
     *
     * @param query 名称搜索词
     * @param pageable 分页及排序条件
     */
    @Query("select t from Team t where t.status = 'ACTIVE' and t.joinPolicy = 'REQUEST' and lower(t.name) like lower(concat('%', :query, '%'))")
    Page<Team> discover(@Param("query") String query, Pageable pageable);
    /**
     * 分页查询用户拥有 ACTIVE 成员关系的 ACTIVE 团队。
     *
     * @param userId 用户 ID
     * @param pageable 分页及排序条件
     */
    @Query("select t from Team t join TeamMember m on m.teamId = t.id where m.userId = :userId and m.status = 'ACTIVE' and t.status = 'ACTIVE'")
    Page<Team> mine(@Param("userId") long userId, Pageable pageable);
}
