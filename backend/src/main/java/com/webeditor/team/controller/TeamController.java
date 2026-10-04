package com.webeditor.team.controller;

import com.webeditor.common.response.ApiResponse;
import com.webeditor.common.security.CurrentUser;
import com.webeditor.identity.application.AuthRateLimiter;
import com.webeditor.team.application.TeamService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/teams")
public class TeamController {
    private final TeamService teams;
    private final AuthRateLimiter limiter;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param teams 团队仓储或服务
     * @param limiter 认证及公共接口限流器
     */
    public TeamController(TeamService teams, AuthRateLimiter limiter) { this.teams = teams; this.limiter = limiter; }
    public record Create(@NotBlank @Size(max = 100) String name, @Size(max = 500) String description) {}
    public record Policy(@NotBlank String joinPolicy) {}
    public record Invite(@Min(1) long userId) {}
    public record Transfer(@Min(1) long userId) {}

    /**
     * 为当前用户创建团队，返回 201 和团队视图。
     *
     * @param body 请求体
     */
    @PostMapping
    ResponseEntity<ApiResponse<TeamService.TeamView>> create(@Valid @RequestBody Create body) {
        return ResponseEntity.status(201).body(ApiResponse.created(teams.create(CurrentUser.id(), body.name(), body.description())));
    }
    /**
     * 分页返回当前用户加入的团队。
     *
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     */
    @GetMapping
    ApiResponse<Page<TeamService.TeamView>> mine(@RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ApiResponse.ok(teams.mine(CurrentUser.id(), page, size));
    }
    /**
     * 按 IP 限流后公开搜索允许申请加入的团队。
     *
     * @param query 名称搜索词
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     * @param request 当前 HTTP 请求
     */
    @GetMapping("/discover")
    ApiResponse<Page<TeamService.TeamView>> discover(@RequestParam(defaultValue = "") @Size(max = 100) String query,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size, HttpServletRequest request) {
        limiter.check("discover", null, request.getRemoteAddr());
        return ApiResponse.ok(teams.discover(query, page, size));
    }
    /**
     * 按当前用户成员权限返回团队详情。
     *
     * @param teamId 团队 ID
     */
    @GetMapping("/{teamId}")
    ApiResponse<TeamService.TeamView> get(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.get(teamId, CurrentUser.id()));
    }
    /**
     * 按当前用户成员权限返回团队成员资料。
     *
     * @param teamId 团队 ID
     */
    @GetMapping("/{teamId}/members")
    ApiResponse<List<TeamService.MemberView>> members(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.members(teamId, CurrentUser.id()));
    }
    /**
     * 由当前团队所有者设置加入策略。
     *
     * @param teamId 团队 ID
     * @param body 请求体
     */
    @PutMapping("/{teamId}/join-policy")
    ApiResponse<TeamService.TeamView> policy(@PathVariable @Min(1) long teamId, @Valid @RequestBody Policy body) {
        return ApiResponse.ok(teams.policy(teamId, CurrentUser.id(), body.joinPolicy()));
    }
    /**
     * 为当前用户提交加入申请，返回 201 和申请视图。
     *
     * @param teamId 团队 ID
     */
    @PostMapping("/{teamId}/join-requests")
    ResponseEntity<ApiResponse<TeamService.RequestView>> request(@PathVariable @Min(1) long teamId) {
        return ResponseEntity.status(201).body(ApiResponse.created(teams.request(teamId, CurrentUser.id())));
    }
    /**
     * 返回当前用户待处理的加入申请。
     */
    @GetMapping("/join-requests/me")
    ApiResponse<List<TeamService.MyRequestView>> myPendingRequests() {
        return ApiResponse.ok(teams.myPendingRequests(CurrentUser.id()));
    }
    /**
     * 撤回当前用户在指定团队的申请，成功返回 204。
     *
     * @param teamId 团队 ID
     */
    @DeleteMapping("/{teamId}/join-requests/me")
    ResponseEntity<Void> withdraw(@PathVariable @Min(1) long teamId) {
        teams.withdraw(teamId, CurrentUser.id()); return ResponseEntity.noContent().build();
    }
    /**
     * 为团队所有者返回待审批申请。
     *
     * @param teamId 团队 ID
     */
    @GetMapping("/{teamId}/join-requests")
    ApiResponse<List<TeamService.RequestView>> pending(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.pending(teamId, CurrentUser.id()));
    }
    /**
     * 由当前所有者批准指定加入申请，成功返回 204。
     *
     * @param teamId 团队 ID
     * @param requestId 加入申请 ID
     */
    @PostMapping("/{teamId}/join-requests/{requestId}/approve")
    ResponseEntity<Void> approve(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long requestId) {
        teams.decide(teamId, CurrentUser.id(), requestId, true); return ResponseEntity.noContent().build();
    }
    /**
     * 由当前所有者拒绝指定加入申请，成功返回 204。
     *
     * @param teamId 团队 ID
     * @param requestId 加入申请 ID
     */
    @PostMapping("/{teamId}/join-requests/{requestId}/reject")
    ResponseEntity<Void> reject(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long requestId) {
        teams.decide(teamId, CurrentUser.id(), requestId, false); return ResponseEntity.noContent().build();
    }
    /**
     * 由当前所有者向已注册用户发送站内邀请，返回 201。
     *
     * @param teamId 团队 ID
     * @param body 请求体
     */
    @PostMapping("/{teamId}/invitations")
    ResponseEntity<ApiResponse<TeamService.InvitationView>> invite(@PathVariable @Min(1) long teamId,
            @Valid @RequestBody Invite body) {
        return ResponseEntity.status(201).body(ApiResponse.created(teams.invite(teamId, CurrentUser.id(), body.userId())));
    }
    /**
     * 由当前所有者按用户名或邮箱查找可邀请用户。
     *
     * @param teamId 团队 ID
     * @param identifier 用户名或邮箱
     */
    @GetMapping("/{teamId}/invitees/lookup")
    ApiResponse<TeamService.InviteeView> lookupInvitee(@PathVariable @Min(1) long teamId,
            @RequestParam @NotBlank @Size(max = 254) String identifier) {
        return ApiResponse.ok(teams.lookupInvitee(teamId, CurrentUser.id(), identifier));
    }
    /**
     * 为当前所有者返回团队邀请记录。
     *
     * @param teamId 团队 ID
     */
    @GetMapping("/{teamId}/invitations")
    ApiResponse<List<TeamService.InvitationView>> invitations(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.invitations(teamId, CurrentUser.id()));
    }
    /**
     * 由当前所有者撤销指定邀请，成功返回 204。
     *
     * @param teamId 团队 ID
     * @param invitationId 邀请 ID
     */
    @DeleteMapping("/{teamId}/invitations/{invitationId}")
    ResponseEntity<Void> revoke(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long invitationId) {
        teams.revokeInvitation(teamId, CurrentUser.id(), invitationId); return ResponseEntity.noContent().build();
    }
    /**
     * 返回当前用户收到的有效站内邀请。
     */
    @GetMapping("/invitations/me")
    ApiResponse<List<TeamService.MyInvitationView>> myInvitations() {
        return ApiResponse.ok(teams.myInvitations(CurrentUser.id()));
    }
    /**
     * 接受发给当前用户的邀请并返回加入的团队。
     *
     * @param invitationId 邀请 ID
     */
    @PostMapping("/invitations/{invitationId}/accept")
    ApiResponse<TeamService.TeamView> accept(@PathVariable @Min(1) long invitationId) {
        return ApiResponse.ok(teams.accept(CurrentUser.id(), invitationId));
    }
    /**
     * 拒绝发给当前用户的指定邀请，成功返回 204。
     *
     * @param invitationId 邀请 ID
     */
    @PostMapping("/invitations/{invitationId}/reject")
    ResponseEntity<Void> reject(@PathVariable @Min(1) long invitationId) {
        teams.rejectInvitation(CurrentUser.id(), invitationId); return ResponseEntity.noContent().build();
    }
    /**
     * 使当前普通成员退出团队，成功返回 204。
     *
     * @param teamId 团队 ID
     */
    @DeleteMapping("/{teamId}/members/me")
    ResponseEntity<Void> leave(@PathVariable @Min(1) long teamId) {
        teams.leave(teamId, CurrentUser.id()); return ResponseEntity.noContent().build();
    }
    /**
     * 由当前所有者移除指定普通成员，成功返回 204。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     */
    @DeleteMapping("/{teamId}/members/{userId}")
    ResponseEntity<Void> remove(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long userId) {
        teams.remove(teamId, CurrentUser.id(), userId); return ResponseEntity.noContent().build();
    }
    /**
     * 由当前所有者将团队所有权转交给指定成员。
     *
     * @param teamId 团队 ID
     * @param body 请求体
     */
    @PutMapping("/{teamId}/owner")
    ResponseEntity<Void> transfer(@PathVariable @Min(1) long teamId, @Valid @RequestBody Transfer body) {
        teams.transfer(teamId, CurrentUser.id(), body.userId()); return ResponseEntity.noContent().build();
    }
}
