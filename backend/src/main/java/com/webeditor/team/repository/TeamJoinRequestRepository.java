package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamJoinRequest;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamJoinRequestRepository extends JpaRepository<TeamJoinRequest, Long> {
    /**
     * 查询用户在指定团队的加入申请。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    Optional<TeamJoinRequest> findByTeamIdAndUserId(long teamId, long userId);
    /**
     * 在指定团队范围内按 ID 查询加入申请。
     *
     * @param id 加入申请 ID
     * @param teamId 团队 ID
     */
    Optional<TeamJoinRequest> findByIdAndTeamId(long id, long teamId);
    /**
     * 按团队和状态查询加入申请，按创建时间升序排列。
     *
     * @param teamId 团队 ID
     * @param status 目标业务状态
     */
    List<TeamJoinRequest> findByTeamIdAndStatusOrderByCreatedAt(long teamId, String status);
    /**
     * 按用户和状态查询加入申请，按创建时间升序排列。
     *
     * @param userId 用户 ID
     * @param status 目标业务状态
     */
    List<TeamJoinRequest> findByUserIdAndStatusOrderByCreatedAt(long userId, String status);
}
