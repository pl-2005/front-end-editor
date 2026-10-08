package com.webeditor.identity.application;

import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    public record UserView(long id, String username, String email, String displayName, String avatarColor) {
        /**
         * 将用户实体转换为公开资料，排除密码摘要及内部版本字段。
         *
         * @param user 用户实体
         */
        static UserView of(AppUser user) { return new UserView(user.getId(), user.getUsername(), user.getEmail(), user.getDisplayName(), user.getAvatarColor()); }
    }
    public record BrowserCredentials(UserView user, String accessToken, long expiresIn) {}
    public record Credentials(UserView user, String accessToken, String refreshToken, long expiresIn, long cookieSeconds) {
        public BrowserCredentials browser() { return new BrowserCredentials(user, accessToken, expiresIn); }
    }
    private final AppUserRepository users;
    private final PasswordEncoder passwords;
    private final TokenService tokens;
    private final RefreshStore refresh;
    private final com.webeditor.collaboration.CollabControlEvents events;
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private final com.fasterxml.jackson.databind.ObjectMapper mapper;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param users 用户仓储
     * @param passwords 密码编码器
     * @param tokens 访问令牌签发服务
     * @param refresh 刷新令牌存储服务
     */
    public AuthService(AppUserRepository users, PasswordEncoder passwords, TokenService tokens, RefreshStore refresh,
            com.webeditor.collaboration.CollabControlEvents events,
            org.springframework.transaction.PlatformTransactionManager transactionManager,
            com.fasterxml.jackson.databind.ObjectMapper mapper) {
        this.users = users; this.passwords = passwords; this.tokens = tokens; this.refresh = refresh; this.events = events;
        this.transactions = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        this.mapper = mapper;
    }
    /**
     * 规范化并校验注册信息，检查账号唯一性，编码密码后保存用户；并发唯一约束冲突转换为业务错误。
     *
     * @param username 用户名
     * @param email 邮箱
     * @param password 密码明文，仅用于校验或编码
     * @param displayName 显示名称
     */
    @Transactional
    public UserView register(String username, String email, String password, String displayName) {
        String normalized = IdentityInput.normalize(username, 50);
        if (normalized.contains("@") || !normalized.matches("[\\p{L}\\p{N}._-]+")) throw new IllegalArgumentException("用户名格式无效");
        String normalizedEmail = email == null || email.isBlank() ? null : IdentityInput.normalize(email, 254);
        String emailValue = normalizedEmail == null ? null : email.trim();
        if (normalizedEmail != null && (!normalizedEmail.contains("@") || normalizedEmail.indexOf('@') != normalizedEmail.lastIndexOf('@')))
            throw new IllegalArgumentException("邮箱格式无效");
        IdentityInput.validatePassword(password);
        String name = displayName == null || displayName.isBlank() ? username.trim() : displayName.trim();
        if (name.isBlank() || name.codePointCount(0, name.length()) > 100) throw new IllegalArgumentException("显示名格式无效");
        if (users.findByNormalizedUsername(normalized).isPresent()) throw new AuthFailure(409, "USERNAME_ALREADY_EXISTS");
        if (normalizedEmail != null && users.findByNormalizedEmail(normalizedEmail).isPresent()) throw new AuthFailure(409, "EMAIL_ALREADY_EXISTS");
        try {
            return UserView.of(users.saveAndFlush(new AppUser(username.trim(), normalized, emailValue,
                    normalizedEmail, passwords.encode(password), name, "#6366F1")));
        } catch (DataIntegrityViolationException e) {
            throw new AuthFailure(409, normalizedEmail != null && String.valueOf(e.getMostSpecificCause().getMessage()).contains("uk_app_user_normalized_email")
                    ? "EMAIL_ALREADY_EXISTS" : "USERNAME_ALREADY_EXISTS");
        }
    }
    /**
     * 按用户名或邮箱校验密码，必要时在用户锁内升级密码摘要，再签发访问令牌和刷新令牌。
     *
     * @param login 登录用户名或邮箱
     * @param password 密码明文，仅用于校验或编码
     */
    public Credentials login(String login, String password) {
        String normalized;
        try { normalized = IdentityInput.normalize(login, 254); } catch (IllegalArgumentException e) { throw unauthenticated(); }
        AppUser user = (normalized.contains("@") ? users.findByNormalizedEmail(normalized)
                : users.findByNormalizedUsername(normalized)).orElseThrow(AuthService::unauthenticated);
        long userId = user.getId();
        return transactions.execute(status -> {
            AppUser locked = users.lockById(userId).orElseThrow(AuthService::unauthenticated);
            if (password == null || !passwords.matches(password, locked.getPasswordHash())) throw unauthenticated();
            if (passwords.upgradeEncoding(locked.getPasswordHash())) {
                locked.upgradeHash(passwords.encode(password));
            }
            return credentials(locked, refresh.issue(locked.getId(), locked.getTokenVersion()));
        });
    }
    /**
     * 在用户写锁内准备凭据后原子轮换；事务结束失败按轮换结果不确定报告。
     *
     * @param credential 刷新令牌
     */
    public Credentials rotate(String credential) {
        boolean[] committed = { false };
        try {
            RefreshStore.Prepared prepared = refresh.inspect(credential);
            return transactions.execute(status -> {
                AppUser user = users.lockById(prepared.user().userId()).orElseThrow(AuthService::unauthenticated);
                if (user.getTokenVersion() != prepared.user().tokenVersion()) throw unauthenticated();
                String next = refresh.nextToken();
                BrowserCredentials browser = new BrowserCredentials(UserView.of(user), tokens.issue(user), tokens.expiresIn());
                try { mapper.writeValueAsBytes(com.webeditor.common.response.ApiResponse.ok(browser)); }
                catch (java.io.IOException e) { throw new AuthFailure(503, "AUTH_SERVICE_UNAVAILABLE"); }
                RefreshStore.Issued issued = refresh.commit(prepared, next);
                committed[0] = true;
                return new Credentials(browser.user(), browser.accessToken(), issued.token(), browser.expiresIn(), issued.cookieSeconds());
            });
        } catch (AuthFailure e) { throw e; }
        catch (RuntimeException e) {
            throw new AuthFailure(503, committed[0] ? "AUTH_REFRESH_OUTCOME_UNKNOWN" : "AUTH_SERVICE_UNAVAILABLE");
        }
    }
    /**
     * 将用户公开资料、访问令牌、刷新令牌和有效期组合为登录凭据。
     *
     * @param user 用户实体
     * @param issued 刷新令牌及 Cookie 剩余寿命
     */
    private Credentials credentials(AppUser user, RefreshStore.Issued issued) {
        return new Credentials(UserView.of(user), tokens.issue(user), issued.token(), tokens.expiresIn(), issued.cookieSeconds());
    }
    /** Commit revocation before the controller reports success; stale versions cannot revoke new sessions. */
    public String logoutCookie(String token) {
        try {
            RefreshStore.Prepared prepared = refresh.inspect(token);
            return transactions.execute(status -> {
                AppUser user = users.lockById(prepared.user().userId()).orElse(null);
                if (user == null || user.getTokenVersion() != prepared.user().tokenVersion()) return "local-only";
                refresh.inspect(token);
                user.revoke(); events.revoked(user.getId(), null, user.getAuthzVersion());
                return "revoked";
            });
        } catch (AuthFailure e) {
            if (e.status() == 401) return "local-only";
            throw e;
        } catch (RuntimeException e) { throw new AuthFailure(503, "AUTH_SERVICE_UNAVAILABLE"); }
    }
    /**
     * 读取指定用户的公开资料，不存在时返回认证错误。
     *
     * @param id 用户 ID
     */
    @Transactional(readOnly = true) public UserView me(long id) { return UserView.of(users.findById(id).orElseThrow(AuthService::unauthenticated)); }
    /**
     * 锁定用户并递增令牌及授权版本，使该用户已有会话失效。
     *
     * @param id 用户 ID
     */
    @Transactional public void logout(long id) {
        AppUser user = users.lockById(id).orElseThrow(AuthService::unauthenticated);
        user.revoke(); events.revoked(id, null, user.getAuthzVersion());
    }
    /**
     * 校验新密码和原密码，在用户锁内更新密码摘要并撤销已有会话。
     *
     * @param id 用户 ID
     * @param current 当前密码
     * @param replacement 新密码
     */
    @Transactional public void changePassword(long id, String current, String replacement) {
        IdentityInput.validatePassword(replacement);
        AppUser user = users.lockById(id).orElseThrow(AuthService::unauthenticated);
        if (current == null || !passwords.matches(current, user.getPasswordHash())) throw unauthenticated();
        user.changePassword(passwords.encode(replacement));
        events.revoked(id, null, user.getAuthzVersion());
    }
    /**
     * 创建统一的 401 认证失败异常，避免泄露账号存在性。
     */
    private static AuthFailure unauthenticated() { return new AuthFailure(401, "AUTHENTICATION_REQUIRED"); }
}
