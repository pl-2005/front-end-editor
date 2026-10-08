package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamMember;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamMemberRepository extends JpaRepository<TeamMember, Long> {
    /** 批量读取当前用户的有效团队角色，避免列表逐行查询。 */
    List<TeamMember> findByUserIdAndStatus(long userId, String status);
    /**
     * 查询团队与用户的成员关系，包含已移除记录。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    Optional<TeamMember> findByTeamIdAndUserId(long teamId, long userId);
    /**
     * 按团队、用户和指定状态查询成员关系。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param status 目标业务状态
     */
    Optional<TeamMember> findByTeamIdAndUserIdAndStatus(long teamId, long userId, String status);
    /**
     * 按团队和状态查询成员关系，按 ID 升序排列。
     *
     * @param teamId 团队 ID
     * @param status 目标业务状态
     */
    List<TeamMember> findByTeamIdAndStatusOrderById(long teamId, String status);
}
