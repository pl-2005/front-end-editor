package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamInvitation;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamInvitationRepository extends JpaRepository<TeamInvitation, Long> {
    /**
     * 在指定团队范围内查询邀请，避免跨团队读取。
     *
     * @param id 邀请 ID
     * @param teamId 团队 ID
     */
    Optional<TeamInvitation> findByIdAndTeamId(long id, long teamId);
    /**
     * 查询团队邀请记录，按 ID 倒序排列。
     *
     * @param teamId 团队 ID
     */
    List<TeamInvitation> findByTeamIdOrderByIdDesc(long teamId);
    /**
     * 查询指定用户的 PENDING 邀请，按 ID 倒序排列；有效期由业务层检查。
     *
     * @param userId 用户 ID
     */
    @Query("select i from TeamInvitation i where i.status = 'PENDING' and i.inviteeUserId = :userId order by i.id desc")
    List<TeamInvitation> findPendingForUser(@Param("userId") long userId);
    /**
     * 查询团队发给指定用户的 PENDING 邀请，供重复邀请检查或成员激活后撤销。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Query("select i from TeamInvitation i where i.teamId = :teamId and i.status = 'PENDING' and i.inviteeUserId = :userId")
    List<TeamInvitation> findPendingForTeamUser(@Param("teamId") long teamId, @Param("userId") long userId);
}
