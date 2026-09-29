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
        static UserView of(AppUser user) { return new UserView(user.getId(), user.getUsername(), user.getEmail(), user.getDisplayName(), user.getAvatarColor()); }
    }
    public record Credentials(UserView user, String accessToken, String refreshToken, long expiresIn) {}
    private final AppUserRepository users;
    private final PasswordEncoder passwords;
    private final TokenService tokens;
    private final RefreshStore refresh;
    public AuthService(AppUserRepository users, PasswordEncoder passwords, TokenService tokens, RefreshStore refresh) {
        this.users = users; this.passwords = passwords; this.tokens = tokens; this.refresh = refresh;
    }
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
    @Transactional
    public Credentials login(String login, String password) {
        String normalized;
        try { normalized = IdentityInput.normalize(login, 254); } catch (IllegalArgumentException e) { throw unauthenticated(); }
        AppUser user = (normalized.contains("@") ? users.findByNormalizedEmail(normalized)
                : users.findByNormalizedUsername(normalized)).orElseThrow(AuthService::unauthenticated);
        if (password == null || !passwords.matches(password, user.getPasswordHash())) throw unauthenticated();
        if (passwords.upgradeEncoding(user.getPasswordHash())) {
            AppUser locked = users.lockById(user.getId()).orElseThrow(AuthService::unauthenticated);
            if (!passwords.matches(password, locked.getPasswordHash())) throw unauthenticated();
            locked.upgradeHash(passwords.encode(password)); user = locked;
        }
        return credentials(user, refresh.create(user.getId(), user.getTokenVersion()));
    }
    @Transactional(readOnly = true)
    public Credentials rotate(String credential) {
        RefreshStore.Rotated rotated = refresh.rotate(credential);
        AppUser user = users.findById(rotated.user().userId()).orElseThrow(AuthService::unauthenticated);
        if (user.getTokenVersion() != rotated.user().tokenVersion()) throw unauthenticated();
        return credentials(user, rotated.token());
    }
    private Credentials credentials(AppUser user, String refreshToken) {
        return new Credentials(UserView.of(user), tokens.issue(user), refreshToken, tokens.expiresIn());
    }
    @Transactional(readOnly = true) public UserView me(long id) { return UserView.of(users.findById(id).orElseThrow(AuthService::unauthenticated)); }
    @Transactional public void logout(long id) { users.lockById(id).orElseThrow(AuthService::unauthenticated).revoke(); }
    @Transactional public void changePassword(long id, String current, String replacement) {
        IdentityInput.validatePassword(replacement);
        AppUser user = users.lockById(id).orElseThrow(AuthService::unauthenticated);
        if (current == null || !passwords.matches(current, user.getPasswordHash())) throw unauthenticated();
        user.changePassword(passwords.encode(replacement));
    }
    private static AuthFailure unauthenticated() { return new AuthFailure(401, "AUTHENTICATION_REQUIRED"); }
}
