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
    public TeamController(TeamService teams, AuthRateLimiter limiter) { this.teams = teams; this.limiter = limiter; }
    public record Create(@NotBlank @Size(max = 100) String name, @Size(max = 500) String description) {}
    public record Policy(@NotBlank String joinPolicy) {}
    public record Invite(@NotBlank @Email String email) {}
    public record Accept(@NotBlank String token) {}
    public record Transfer(@Min(1) long userId) {}

    @PostMapping
    ResponseEntity<ApiResponse<TeamService.TeamView>> create(@Valid @RequestBody Create body) {
        return ResponseEntity.status(201).body(ApiResponse.created(teams.create(CurrentUser.id(), body.name(), body.description())));
    }
    @GetMapping
    ApiResponse<Page<TeamService.TeamView>> mine(@RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ApiResponse.ok(teams.mine(CurrentUser.id(), page, size));
    }
    @GetMapping("/discover")
    ApiResponse<Page<TeamService.TeamView>> discover(@RequestParam(defaultValue = "") @Size(max = 100) String query,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size, HttpServletRequest request) {
        limiter.check("discover", null, request.getRemoteAddr());
        return ApiResponse.ok(teams.discover(query, page, size));
    }
    @GetMapping("/{teamId}")
    ApiResponse<TeamService.TeamView> get(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.get(teamId, CurrentUser.id()));
    }
    @GetMapping("/{teamId}/members")
    ApiResponse<List<TeamService.MemberView>> members(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.members(teamId, CurrentUser.id()));
    }
    @PutMapping("/{teamId}/join-policy")
    ApiResponse<TeamService.TeamView> policy(@PathVariable @Min(1) long teamId, @Valid @RequestBody Policy body) {
        return ApiResponse.ok(teams.policy(teamId, CurrentUser.id(), body.joinPolicy()));
    }
    @PostMapping("/{teamId}/join-requests")
    ResponseEntity<ApiResponse<TeamService.RequestView>> request(@PathVariable @Min(1) long teamId) {
        return ResponseEntity.status(201).body(ApiResponse.created(teams.request(teamId, CurrentUser.id())));
    }
    @DeleteMapping("/{teamId}/join-requests/me")
    ResponseEntity<Void> withdraw(@PathVariable @Min(1) long teamId) {
        teams.withdraw(teamId, CurrentUser.id()); return ResponseEntity.noContent().build();
    }
    @GetMapping("/{teamId}/join-requests")
    ApiResponse<List<TeamService.RequestView>> pending(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.pending(teamId, CurrentUser.id()));
    }
    @PostMapping("/{teamId}/join-requests/{requestId}/approve")
    ResponseEntity<Void> approve(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long requestId) {
        teams.decide(teamId, CurrentUser.id(), requestId, true); return ResponseEntity.noContent().build();
    }
    @PostMapping("/{teamId}/join-requests/{requestId}/reject")
    ResponseEntity<Void> reject(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long requestId) {
        teams.decide(teamId, CurrentUser.id(), requestId, false); return ResponseEntity.noContent().build();
    }
    @PostMapping("/{teamId}/invitations")
    ResponseEntity<ApiResponse<TeamService.IssuedInvitation>> invite(@PathVariable @Min(1) long teamId,
            @Valid @RequestBody Invite body) {
        return ResponseEntity.status(201).header("Cache-Control", "no-store")
                .body(ApiResponse.created(teams.invite(teamId, CurrentUser.id(), body.email())));
    }
    @GetMapping("/{teamId}/invitations")
    ApiResponse<List<TeamService.InvitationView>> invitations(@PathVariable @Min(1) long teamId) {
        return ApiResponse.ok(teams.invitations(teamId, CurrentUser.id()));
    }
    @DeleteMapping("/{teamId}/invitations/{invitationId}")
    ResponseEntity<Void> revoke(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long invitationId) {
        teams.revokeInvitation(teamId, CurrentUser.id(), invitationId); return ResponseEntity.noContent().build();
    }
    @PostMapping("/invitations/accept")
    ApiResponse<TeamService.TeamView> accept(@Valid @RequestBody Accept body) {
        return ApiResponse.ok(teams.accept(CurrentUser.id(), body.token()));
    }
    @DeleteMapping("/{teamId}/members/me")
    ResponseEntity<Void> leave(@PathVariable @Min(1) long teamId) {
        teams.leave(teamId, CurrentUser.id()); return ResponseEntity.noContent().build();
    }
    @DeleteMapping("/{teamId}/members/{userId}")
    ResponseEntity<Void> remove(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long userId) {
        teams.remove(teamId, CurrentUser.id(), userId); return ResponseEntity.noContent().build();
    }
    @PutMapping("/{teamId}/owner")
    ResponseEntity<Void> transfer(@PathVariable @Min(1) long teamId, @Valid @RequestBody Transfer body) {
        teams.transfer(teamId, CurrentUser.id(), body.userId()); return ResponseEntity.noContent().build();
    }
}
