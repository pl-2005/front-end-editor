package com.webeditor;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.common.security.*;
import com.webeditor.identity.application.*;
import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.support.SimpleTransactionStatus;

class AuthSessionTests {
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final SecurityErrors errors = new SecurityErrors(mapper);

    @Test void rejectsMissingNullSiblingAndCrossSiteOriginsWithoutCookies() throws Exception {
        var filter = new AuthOriginFilter("http://localhost:5173", false, true, errors);
        for (String origin : new String[] { "", "null", "http://evil.localhost:5173", "http://localhost:5174", "http://localhost:5173,https://evil.example" }) {
            var request = new MockHttpServletRequest("POST", "/api/auth/refresh");
            request.setContentType("application/json"); request.addHeader("X-Web-Editor-Request", "browser");
            if (!origin.isEmpty()) request.addHeader("Origin", origin);
            var response = new MockHttpServletResponse();
            filter.doFilter(request, response, (req, res) -> { throw new AssertionError("Rejected requests must stop"); });
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(response.getHeader("Set-Cookie")).isNull();
            assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        }
        for (boolean crossSite : new boolean[] { false, true }) {
            var request = new MockHttpServletRequest("POST", "/api/auth/logout");
            request.addHeader("Origin", "http://localhost:5173"); request.setContentType("application/json");
            if (crossSite) { request.addHeader("X-Web-Editor-Request", "browser"); request.addHeader("Sec-Fetch-Site", "cross-site"); }
            var response = new MockHttpServletResponse();
            filter.doFilter(request, response, (req, res) -> { throw new AssertionError(); });
            assertThat(response.getStatus()).isEqualTo(403);
        }
    }
    @Test void exactOriginPassesAndConfigurationRejectsUnsafeDeployment() throws Exception {
        var filter = new AuthOriginFilter("http://localhost:5173", false, true, errors);
        var request = new MockHttpServletRequest("POST", "/api/auth/refresh");
        request.addHeader("Origin", "http://localhost:5173"); request.addHeader("X-Web-Editor-Request", "browser"); request.setContentType("application/json");
        boolean[] reached = { false };
        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> reached[0] = true);
        assertThat(reached[0]).isTrue();
        for (String origin : new String[] { "", "*", "https://example.com/", "http://example.com", "https://user@example.com" })
            assertThatThrownBy(() -> new AuthOriginFilter(origin, true, false, errors)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AuthOriginFilter("http://localhost:5173", false, false, errors)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void cookiesAreHostOnlyHttpOnlyAndResponseContainsNoRefreshToken() throws Exception {
        var cookie = new AuthCookie(false);
        var response = new MockHttpServletResponse();
        var writer = new BrowserCredentialsWriter(mapper, cookie, errors);
        writer.write(new MockHttpServletRequest(), response,
                new AuthService.Credentials(new AuthService.UserView(1, "user", null, "User", "#6366F1"), "access", "refresh-secret", 600, 123), true);
        assertThat(response.getHeader("Set-Cookie")).contains("HttpOnly", "SameSite=Strict", "Path=/api/auth", "Max-Age=123").doesNotContain("Domain=");
        assertThat(response.getContentAsString()).doesNotContain("refresh-secret", "refreshToken", "cookieSeconds");
        var request = new MockHttpServletRequest();
        request.setCookies(new jakarta.servlet.http.Cookie(AuthCookie.NAME, "one"), new jakarta.servlet.http.Cookie(AuthCookie.NAME, "two"));
        assertThatThrownBy(() -> cookie.read(request)).isInstanceOf(AuthFailure.class);
        var secure = new MockHttpServletResponse(); new AuthCookie(true).clear(secure);
        assertThat(secure.getHeader("Set-Cookie")).contains("Max-Age=0", "Secure", "HttpOnly", "Path=/api/auth");
    }
    @Test void logoutAloneSkipsBearerAndDatabaseOutageReturns503() throws Exception {
        var users = mock(AppUserRepository.class); var decoder = mock(JwtDecoder.class);
        var filter = new JwtAuthenticationFilter(decoder, users, errors, "issuer", "audience");
        boolean[] reached = { false };
        filter.doFilter(new MockHttpServletRequest("POST", "/api/auth/logout"), new MockHttpServletResponse(), (req, res) -> reached[0] = true);
        assertThat(reached[0]).isTrue();
        var password = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("PUT", "/api/auth/password"), password, (req, res) -> { throw new AssertionError(); });
        assertThat(password.getStatus()).isEqualTo(401);
        Instant now = Instant.now();
        when(decoder.decode("access")).thenReturn(Jwt.withTokenValue("access").header("alg", "HS256").issuer("issuer").subject("1")
                .audience(java.util.List.of("audience")).claim("jti", "id").issuedAt(now).notBefore(now).expiresAt(now.plusSeconds(600)).claim("token_version", 0L).build());
        when(users.findById(1L)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("offline"));
        var request = new MockHttpServletRequest("GET", "/api/auth/me"); request.addHeader("Authorization", "Bearer access");
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> { throw new AssertionError(); });
        assertThat(response.getStatus()).isEqualTo(503); assertThat(response.getHeader("Set-Cookie")).isNull();
    }
    @Test void preparationFailureDoesNotConsumeAndTransactionEndFailureIsUnknown() {
        var users = mock(AppUserRepository.class); var refresh = mock(RefreshStore.class); var tokens = mock(TokenService.class);
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var events = mock(com.webeditor.collaboration.CollabControlEvents.class);
        var auth = new AuthService(users, mock(PasswordEncoder.class), tokens, refresh, events, manager, mapper);
        var prepared = new RefreshStore.Prepared("key", "value", "family", new RefreshStore.RefreshUser(1, 0));
        when(refresh.inspect("old")).thenReturn(prepared);
        when(users.lockById(1L)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("offline"));
        assertThatThrownBy(() -> auth.rotate("old")).isInstanceOfSatisfying(AuthFailure.class, e -> assertThat(e.code()).isEqualTo("AUTH_SERVICE_UNAVAILABLE"));
        verify(refresh, never()).commit(any(), anyString());
        var user = mock(AppUser.class);
        when(user.getId()).thenReturn(1L); when(user.getTokenVersion()).thenReturn(0L);
        doReturn(Optional.of(user)).when(users).lockById(1L);
        when(tokens.issue(user)).thenReturn("access"); when(tokens.expiresIn()).thenReturn(600L);
        when(refresh.nextToken()).thenReturn("next"); when(refresh.commit(prepared, "next")).thenReturn(new RefreshStore.Issued("next", 1800));
        doThrow(new TransactionSystemException("commit failed")).when(manager).commit(any());
        assertThatThrownBy(() -> auth.rotate("old")).isInstanceOfSatisfying(AuthFailure.class, e -> assertThat(e.code()).isEqualTo("AUTH_REFRESH_OUTCOME_UNKNOWN"));
        verify(refresh).commit(prepared, "next");
    }
    @Test void oldVersionCookieCannotRevokeNewSessions() {
        var users = mock(AppUserRepository.class); var refresh = mock(RefreshStore.class);
        var manager = mock(PlatformTransactionManager.class); when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var events = mock(com.webeditor.collaboration.CollabControlEvents.class);
        var auth = new AuthService(users, mock(PasswordEncoder.class), mock(TokenService.class), refresh, events, manager, mapper);
        when(refresh.inspect("old")).thenReturn(new RefreshStore.Prepared("key", "value", "family", new RefreshStore.RefreshUser(1, 0)));
        var user = mock(AppUser.class); when(user.getTokenVersion()).thenReturn(1L); when(users.lockById(1L)).thenReturn(Optional.of(user));
        assertThat(auth.logoutCookie("old")).isEqualTo("local-only"); verify(user, never()).revoke(); verifyNoInteractions(events);
    }
    @Test void responsePreparationFailureAfterRotationReportsUnknownWithoutCookie() throws Exception {
        var failingMapper = mock(ObjectMapper.class);
        when(failingMapper.writeValueAsBytes(any())).thenThrow(new com.fasterxml.jackson.core.JsonProcessingException("serialization failed") {});
        var response = new MockHttpServletResponse();
        new BrowserCredentialsWriter(failingMapper, new AuthCookie(false), errors).write(
                new MockHttpServletRequest("POST", "/api/auth/refresh"), response,
                new AuthService.Credentials(new AuthService.UserView(1, "user", null, "User", "#6366F1"), "access", "refresh", 600, 1800), true);
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getHeader("Set-Cookie")).isNull();
        assertThat(response.getContentAsString()).contains("AUTH_REFRESH_OUTCOME_UNKNOWN");
    }
    @Test void redisExecutionTimeoutIsUnknownAndDoesNotRestoreUsedTokens() {
        var redis = mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        var store = new RefreshStore(redis, "test", java.time.Duration.ofMinutes(30), java.time.Duration.ofHours(12), 5);
        when(redis.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new org.springframework.dao.QueryTimeoutException("execution timeout"));
        var prepared = new RefreshStore.Prepared("old-key", "1:0:family:" + (System.currentTimeMillis() + 60000), "family", new RefreshStore.RefreshUser(1, 0));
        assertThatThrownBy(() -> store.commit(prepared, "next")).isInstanceOfSatisfying(AuthFailure.class,
                e -> assertThat(e.code()).isEqualTo("AUTH_REFRESH_OUTCOME_UNKNOWN"));
        verify(redis, never()).opsForValue();
    }
}
