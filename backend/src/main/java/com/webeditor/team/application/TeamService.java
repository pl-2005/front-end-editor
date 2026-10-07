package com.webeditor.team.application;

import com.webeditor.identity.application.IdentityInput;
import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.team.domain.*;
import com.webeditor.team.repository.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamService {
    private final TeamRepository teams;
    private final TeamMemberRepository members;
    private final TeamInvitationRepository invitations;
    private final TeamJoinRequestRepository requests;
    private final AppUserRepository users;
    private final TeamAccessService access;
    private final EntityManager entityManager;
    private final com.webeditor.collaboration.CollabControlEvents events;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param teams 团队仓储或服务
     * @param members 团队成员仓储
     * @param invitations 团队邀请仓储
     * @param requests 团队加入申请仓储
     * @param users 用户仓储
     * @param access 团队及项目权限校验服务
     * @param entityManager JPA 实体管理器
     */
    public TeamService(TeamRepository teams, TeamMemberRepository members, TeamInvitationRepository invitations,
            TeamJoinRequestRepository requests, AppUserRepository users, TeamAccessService access, EntityManager entityManager,
            com.webeditor.collaboration.CollabControlEvents events) {
        this.teams = teams; this.members = members; this.invitations = invitations;
        this.requests = requests; this.users = users; this.access = access; this.entityManager = entityManager;
        this.events = events;
    }
    public record TeamView(long id, String name, String description, String joinPolicy) {
        /**
         * 将团队实体转换为包含公开元数据及加入策略的视图。
         *
         * @param t 团队实体
         */
        static TeamView of(Team t) { return new TeamView(t.getId(), t.getName(), t.getDescription(), t.getJoinPolicy()); }
    }
    public record MemberView(long userId, String username, String displayName, String role) {}
    public record RequestView(long id, long userId, String username, String status, Instant createdAt) {}
    public record MyRequestView(long id, long teamId, String status, Instant createdAt) {}
    public record InviteeView(long userId, String username, String displayName) {}
    public record InvitationView(long id, Long inviteeUserId, String username, String email, String status, Instant expiresAt) {}
    public record MyInvitationView(long id, long teamId, String teamName, Instant expiresAt) {}

    /**
     * 校验用户后创建团队和 OWNER 成员记录，并更新创建者授权版本。
     *
     * @param userId 用户 ID
     * @param name 名称
     * @param description 描述，允许为空
     */
    @Transactional
    public TeamView create(long userId, String name, String description) {
        requireUser(userId);
        Team team = teams.saveAndFlush(new Team(name.trim(), trim(description)));
        members.save(new TeamMember(team.getId(), userId, "OWNER"));
        bump(userId);
        return TeamView.of(team);
    }
    /**
     * 分页查询当前用户作为有效成员加入的有效团队。
     *
     * @param userId 用户 ID
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     */
    @Transactional(readOnly = true)
    public Page<TeamView> mine(long userId, int page, int size) {
        requireUser(userId);
        return teams.mine(userId, PageRequest.of(page, size)).map(TeamView::of);
    }
    /**
     * 按名称分页搜索有效且允许申请加入的团队。
     *
     * @param query 名称搜索词
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     */
    @Transactional(readOnly = true)
    public Page<TeamView> discover(String query, int page, int size) {
        return teams.discover(query.trim(), PageRequest.of(page, size)).map(TeamView::of);
    }
    /**
     * 验证成员权限后读取团队公开详情。
     *
     * @param teamId 团队 ID
     *
     * @param userId 用户 ID
     */
    @Transactional(readOnly = true)
    public TeamView get(long teamId, long userId) {
        access.member(teamId, userId);
        return TeamView.of(teams.findById(teamId).orElseThrow());
    }
    /**
     * 验证成员权限后查询有效成员，并补充用户公开资料。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Transactional(readOnly = true)
    public List<MemberView> members(long teamId, long userId) {
        access.member(teamId, userId);
        return members.findByTeamIdAndStatusOrderById(teamId, "ACTIVE").stream().map(m -> {
            AppUser u = requireUser(m.getUserId());
            return new MemberView(u.getId(), u.getUsername(), u.getDisplayName(), m.getRole());
        }).toList();
    }
    /**
     * 锁定团队并验证所有者身份，更新经过校验的加入策略。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param policy 加入策略
     */
    @Transactional
    public TeamView policy(long teamId, long userId, String policy) {
        Team team = lockTeam(teamId);
        access.owner(teamId, userId);
        if (!"REQUEST".equals(policy) && !"INVITE_ONLY".equals(policy)) throw new IllegalArgumentException("加入策略无效");
        team.setJoinPolicy(policy);
        return TeamView.of(team);
    }
    /**
     * 在团队锁内检查加入策略和成员状态，新建或重新开启加入申请；待处理申请直接复用。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Transactional
    public RequestView request(long teamId, long userId) {
        Team team = lockTeam(teamId);
        requireUser(userId);
        if (!"REQUEST".equals(team.getJoinPolicy())) throw new TeamFailure(403, "ACCESS_DENIED", "团队不接受加入申请");
        if (members.findByTeamIdAndUserIdAndStatus(teamId, userId, "ACTIVE").isPresent())
            throw conflict("已是团队成员");
        TeamJoinRequest request = requests.findByTeamIdAndUserId(teamId, userId).orElse(null);
        if (request == null) request = new TeamJoinRequest(teamId, userId);
        else if (!"PENDING".equals(request.getStatus())) request.reopen();
        return view(requests.saveAndFlush(request));
    }
    /**
     * 读取指定用户当前待处理的加入申请。
     *
     * @param userId 用户 ID
     */
    @Transactional(readOnly = true)
    public List<MyRequestView> myPendingRequests(long userId) {
        requireUser(userId);
        return requests.findByUserIdAndStatusOrderByCreatedAt(userId, "PENDING").stream()
                .map(r -> new MyRequestView(r.getId(), r.getTeamId(), r.getStatus(), r.getCreatedAt())).toList();
    }
    /**
     * 锁定团队后将当前用户待处理申请标记为已撤回。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Transactional
    public void withdraw(long teamId, long userId) {
        lockTeam(teamId);
        TeamJoinRequest request = requests.findByTeamIdAndUserId(teamId, userId)
                .filter(r -> "PENDING".equals(r.getStatus()))
                .orElseThrow(() -> new TeamFailure(404, "JOIN_REQUEST_NOT_FOUND", "申请不存在"));
        request.resolve("WITHDRAWN");
    }
    /**
     * 要求团队所有者权限，读取按创建时间排序的待审批申请。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Transactional(readOnly = true)
    public List<RequestView> pending(long teamId, long userId) {
        access.owner(teamId, userId);
        return requests.findByTeamIdAndStatusOrderByCreatedAt(teamId, "PENDING").stream().map(this::view).toList();
    }
    /**
     * 锁定团队并校验所有者权限，批准时检查加入策略并激活成员，再记录审批结果。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param requestId 加入申请 ID
     * @param approve 是否批准加入申请
     */
    @Transactional
    public void decide(long teamId, long userId, long requestId, boolean approve) {
        Team team = lockTeam(teamId);
        access.owner(teamId, userId);
        TeamJoinRequest request = requests.findByIdAndTeamId(requestId, teamId)
                .filter(r -> "PENDING".equals(r.getStatus()))
                .orElseThrow(() -> new TeamFailure(404, "JOIN_REQUEST_NOT_FOUND", "申请不存在"));
        if (approve) {
            if (!"REQUEST".equals(team.getJoinPolicy())) throw conflict("当前加入策略不允许审批");
            requireUser(request.getUserId());
            activate(teamId, request.getUserId());
        }
        request.resolve(approve ? "APPROVED" : "REJECTED");
    }
    /**
     * 要求团队所有者权限，按账号查找已注册用户并拒绝已在团队中的成员。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param identifier 用户名或邮箱
     */
    @Transactional(readOnly = true)
    public InviteeView lookupInvitee(long teamId, long userId, String identifier) {
        access.owner(teamId, userId);
        AppUser target = findInvitee(identifier);
        if (members.findByTeamIdAndUserIdAndStatus(teamId, target.getId(), "ACTIVE").isPresent())
            throw conflict("用户已是团队成员");
        return new InviteeView(target.getId(), target.getUsername(), target.getDisplayName());
    }
    /**
     * 由所有者按用户名或邮箱关键词模糊查找可邀请用户，最多返回 20 条。
     *
     * @param teamId 团队 ID
     * @param userId 当前用户 ID
     * @param query 搜索关键词
     */
    @Transactional(readOnly = true)
    public List<InviteeView> searchInvitees(long teamId, long userId, String query) {
        access.owner(teamId, userId);
        String normalized = IdentityInput.normalize(query, 254);
        return users.searchInvitees(teamId, normalized, PageRequest.of(0, 20)).stream()
                .map(target -> new InviteeView(target.getId(), target.getUsername(), target.getDisplayName()))
                .toList();
    }

    /** 规范化用户名或邮箱后精确查找已注册用户。 */
    private AppUser findInvitee(String identifier) {
        boolean byEmail = identifier != null && identifier.contains("@");
        String normalized = IdentityInput.normalize(identifier, byEmail ? 254 : 50);
        if (byEmail && normalized.indexOf('@') != normalized.lastIndexOf('@'))
            throw new IllegalArgumentException("邮箱格式无效");
        return (byEmail ? users.findByNormalizedEmail(normalized) : users.findByNormalizedUsername(normalized))
                .orElseThrow(() -> new TeamFailure(404, "USER_NOT_FOUND", "未找到对应的已注册用户"));
    }
    /**
     * 在团队锁内由所有者邀请已注册用户，拒绝现有成员及重复有效邀请，并设置七天有效期。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param inviteeUserId 受邀用户 ID
     */
    @Transactional
    public InvitationView invite(long teamId, long userId, long inviteeUserId) {
        lockTeam(teamId);
        access.owner(teamId, userId);
        AppUser target = requireUser(inviteeUserId);
        if (members.findByTeamIdAndUserIdAndStatus(teamId, target.getId(), "ACTIVE").isPresent())
            throw conflict("用户已是团队成员");
        String email = target.getNormalizedEmail();
        List<TeamInvitation> pending = invitations.findPendingForTeamUser(teamId, target.getId());
        for (TeamInvitation prior : pending) {
            if (prior.usable()) throw conflict("已有待处理邀请");
            prior.revoke();
        }
        invitations.flush();
        TeamInvitation invitation = invitations.saveAndFlush(new TeamInvitation(teamId,
                target.getId(), email, Instant.now().plus(7, ChronoUnit.DAYS)));
        return invitationView(invitation);
    }
    /**
     * 要求所有者权限，按 ID 倒序返回团队邀请记录。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Transactional(readOnly = true)
    public List<InvitationView> invitations(long teamId, long userId) {
        access.owner(teamId, userId);
        return invitations.findByTeamIdOrderByIdDesc(teamId).stream().map(this::invitationView).toList();
    }
    /**
     * 返回发给指定用户、仍可使用且所属团队有效的邀请。
     *
     * @param userId 用户 ID
     */
    @Transactional(readOnly = true)
    public List<MyInvitationView> myInvitations(long userId) {
        requireUser(userId);
        return invitations.findPendingForUser(userId).stream()
                .filter(TeamInvitation::usable)
                .flatMap(invitation -> teams.findById(invitation.getTeamId()).stream()
                        .filter(team -> "ACTIVE".equals(team.getStatus()))
                        .map(team -> new MyInvitationView(invitation.getId(), team.getId(), team.getName(), invitation.getExpiresAt())))
                .toList();
    }
    /**
     * 在团队锁内验证所有者及邀请有效性，再撤销指定邀请。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param invitationId 邀请 ID
     */
    @Transactional
    public void revokeInvitation(long teamId, long userId, long invitationId) {
        lockTeam(teamId);
        access.owner(teamId, userId);
        TeamInvitation invitation = invitations.findByIdAndTeamId(invitationId, teamId)
                .orElseThrow(() -> new TeamFailure(404, "INVITATION_NOT_FOUND", "邀请不存在"));
        if (!invitation.usable()) throw gone();
        invitation.revoke();
    }
    /**
     * 锁定邀请所属团队并刷新邀请状态，核对受邀人和有效期后激活成员并消费邀请。
     *
     * @param userId 用户 ID
     * @param invitationId 邀请 ID
     */
    @Transactional
    public TeamView accept(long userId, long invitationId) {
        AppUser user = requireUser(userId);
        TeamInvitation invitation = invitations.findById(invitationId).orElseThrow(TeamService::gone);
        Team team = lockTeam(invitation.getTeamId());
        entityManager.refresh(invitation);
        if (!invitation.usable() || !addressedTo(invitation, user)) throw gone();
        if (members.findByTeamIdAndUserIdAndStatus(team.getId(), userId, "ACTIVE").isPresent()) throw gone();
        activate(team.getId(), userId);
        invitation.consume();
        return TeamView.of(team);
    }
    /**
     * 锁定团队并刷新邀请状态，确认受邀人及有效期后拒绝邀请。
     *
     * @param userId 用户 ID
     * @param invitationId 邀请 ID
     */
    @Transactional
    public void rejectInvitation(long userId, long invitationId) {
        AppUser user = requireUser(userId);
        TeamInvitation invitation = invitations.findById(invitationId).orElseThrow(TeamService::gone);
        lockTeam(invitation.getTeamId());
        entityManager.refresh(invitation);
        if (!invitation.usable() || !addressedTo(invitation, user)) throw gone();
        invitation.reject();
    }
    /**
     * 锁定团队后移除当前成员并更新授权版本；所有者必须先转移所有权。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @Transactional
    public void leave(long teamId, long userId) {
        lockTeam(teamId);
        TeamMember member = access.member(teamId, userId);
        if ("OWNER".equals(member.getRole())) throw conflict("请先转移团队所有权");
        member.remove(); bump(userId);
        revoked(userId, teamId);
    }
    /**
     * 要求所有者权限，在团队锁内移除普通成员并更新其授权版本。
     *
     * @param teamId 团队 ID
     * @param ownerId 当前所有者用户 ID
     * @param memberId 待移除成员用户 ID
     */
    @Transactional
    public void remove(long teamId, long ownerId, long memberId) {
        lockTeam(teamId);
        access.owner(teamId, ownerId);
        TeamMember member = access.member(teamId, memberId);
        if ("OWNER".equals(member.getRole())) throw conflict("不能移除当前所有者");
        member.remove(); bump(memberId);
        revoked(memberId, teamId);
    }
    /**
     * 在团队锁内将所有权转交给另一有效成员，先刷新旧所有者角色，再更新双方授权版本。
     *
     * @param teamId 团队 ID
     * @param ownerId 当前所有者用户 ID
     * @param nextOwnerId 接任所有者用户 ID
     */
    @Transactional
    public void transfer(long teamId, long ownerId, long nextOwnerId) {
        lockTeam(teamId);
        TeamMember owner = access.owner(teamId, ownerId);
        if (ownerId == nextOwnerId) throw conflict("目标已经是所有者");
        TeamMember next = access.member(teamId, nextOwnerId);
        owner.transferTo("MEMBER"); members.flush(); next.transferTo("OWNER");
        bump(ownerId); bump(nextOwnerId);
    }
    /**
     * 以悲观写锁读取有效团队，不存在时返回 404。
     *
     * @param teamId 团队 ID
     */
    private Team lockTeam(long teamId) {
        return teams.lockActive(teamId).orElseThrow(() -> new TeamFailure(404, "TEAM_NOT_FOUND", "团队不存在"));
    }
    /**
     * 新建或恢复普通成员关系，撤销该用户在团队内的待处理邀请，并更新授权版本。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    private void activate(long teamId, long userId) {
        requireUser(userId);
        TeamMember old = members.findByTeamIdAndUserId(teamId, userId).orElse(null);
        if (old == null) members.save(new TeamMember(teamId, userId, "MEMBER"));
        else if ("ACTIVE".equals(old.getStatus())) throw conflict("已是团队成员");
        else old.activate();
        invitations.findPendingForTeamUser(teamId, userId)
                .forEach(TeamInvitation::revoke);
        bump(userId);
    }
    /**
     * 原子递增用户授权版本，用户不存在时返回 404。
     *
     * @param userId 用户 ID
     */
    private void revoked(long userId, long teamId) {
        entityManager.flush();
        long version = ((Number) entityManager.createNativeQuery("SELECT authz_version FROM app_user WHERE id=?")
                .setParameter(1, userId).getSingleResult()).longValue();
        events.revoked(userId, teamId, version);
    }
    private void bump(long userId) {
        if (users.incrementAuthzVersion(userId) != 1) throw new TeamFailure(404, "USER_NOT_FOUND", "用户不存在");
    }
    /**
     * 查询用户实体，不存在时抛出 USER_NOT_FOUND。
     *
     * @param id 用户 ID
     */
    private AppUser requireUser(long id) {
        return users.findById(id).orElseThrow(() -> new TeamFailure(404, "USER_NOT_FOUND", "用户不存在"));
    }
    /**
     * 将加入申请与申请人用户名组合为申请视图。
     *
     * @param request 加入申请实体
     */
    private RequestView view(TeamJoinRequest request) {
        AppUser user = requireUser(request.getUserId());
        return new RequestView(request.getId(), user.getId(), user.getUsername(), request.getStatus(), request.getCreatedAt());
    }
    /**
     * 组合邀请及受邀人资料；用户不存在时保留邀请并将用户名置空。
     *
     * @param invitation 邀请实体
     */
    private InvitationView invitationView(TeamInvitation invitation) {
        AppUser user = invitation.getInviteeUserId() == null ? null
                : users.findById(invitation.getInviteeUserId()).orElse(null);
        return new InvitationView(invitation.getId(), invitation.getInviteeUserId(),
                user == null ? null : user.getUsername(), invitation.getEmailNormalized(),
                invitation.getStatus(), invitation.getExpiresAt());
    }
    /**
     * 按受邀用户 ID 判断邀请是否发给当前用户。
     *
     * @param invitation 邀请实体
     * @param user 用户实体
     */
    private static boolean addressedTo(TeamInvitation invitation, AppUser user) {
        return invitation.getInviteeUserId() != null && invitation.getInviteeUserId().equals(user.getId());
    }
    /**
     * 去除首尾空白，将空文本统一为 null。
     *
     * @param value 待规范化或处理的文本
     */
    private static String trim(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    /**
     * 创建携带业务说明的 409 团队状态冲突异常。
     *
     * @param message 错误或业务说明
     */
    private static TeamFailure conflict(String message) { return new TeamFailure(409, "TEAM_STATE_CONFLICT", message); }
    /**
     * 创建邀请无效或过期对应的 410 异常。
     */
    private static TeamFailure gone() { return new TeamFailure(410, "INVITATION_GONE", "邀请无效或已过期"); }
}
