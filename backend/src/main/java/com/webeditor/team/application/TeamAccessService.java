package com.webeditor.team.application;

import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.project.domain.Project;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.team.domain.Team;
import com.webeditor.team.domain.TeamMember;
import com.webeditor.team.repository.TeamMemberRepository;
import com.webeditor.team.repository.TeamRepository;
import org.springframework.stereotype.Service;

@Service
public class TeamAccessService {
    private final AppUserRepository users;
    private final TeamRepository teams;
    private final TeamMemberRepository members;
    private final ProjectRepository projects;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param users 用户仓储
     * @param teams 团队仓储或服务
     * @param members 团队成员仓储
     * @param projects 项目仓储
     */
    public TeamAccessService(AppUserRepository users, TeamRepository teams, TeamMemberRepository members, ProjectRepository projects) {
        this.users = users; this.teams = teams; this.members = members; this.projects = projects;
    }
    /**
     * 验证用户及团队有效且存在 ACTIVE 成员关系；统一返回 404 以隐藏不可访问团队。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @return 经权限校验的 ACTIVE 成员关系
     */
    public TeamMember member(long teamId, long userId) {
        if (!users.existsById(userId) || teams.findById(teamId).filter(t -> "ACTIVE".equals(t.getStatus())).isEmpty())
            throw new TeamFailure(404, "TEAM_NOT_FOUND", "团队不存在");
        return members.findByTeamIdAndUserIdAndStatus(teamId, userId, "ACTIVE")
                .orElseThrow(() -> new TeamFailure(404, "TEAM_NOT_FOUND", "团队不存在"));
    }
    /**
     * 在有效成员校验基础上要求 OWNER 角色，不满足时返回 403。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @return 经权限校验的 OWNER 成员关系
     */
    public TeamMember owner(long teamId, long userId) {
        TeamMember member = member(teamId, userId);
        if (!"OWNER".equals(member.getRole())) throw new TeamFailure(403, "ACCESS_DENIED", "仅团队所有者可执行此操作");
        return member;
    }
    /**
     * 先校验团队成员身份，再读取该团队的有效且非遗留无主项目。
     *
     * @param teamId 团队 ID
     * @param projectId 项目 ID
     * @param userId 用户 ID
     * @return 当前成员有权访问的有效团队项目
     */
    public Project project(long teamId, long projectId, long userId) {
        member(teamId, userId);
        return projects.findByIdAndTeamIdAndStatusAndLegacyUnownedFalse(projectId, teamId, (byte) 1)
                .orElseThrow(() -> new TeamFailure(404, "PROJECT_NOT_FOUND", "项目不存在"));
    }
}
