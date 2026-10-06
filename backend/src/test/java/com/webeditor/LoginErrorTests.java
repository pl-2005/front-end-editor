package com.webeditor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.common.security.JsonAuthenticationFilter;
import com.webeditor.common.security.JwtAuthenticationFilter;
import com.webeditor.common.security.SecurityErrors;
import com.webeditor.identity.application.AuthFailure;
import com.webeditor.identity.application.AuthRateLimiter;
import com.webeditor.identity.repository.AppUserRepository;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.oauth2.jwt.JwtDecoder;

class LoginErrorTests {
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final SecurityErrors errors = new SecurityErrors(mapper);

    @Test void wrongPasswordReturnsCredentialError() throws Exception {
        assertLoginFailure(new BadCredentialsException("Invalid credentials"));
    }

    @Test void missingAccountReturnsTheSameCredentialError() throws Exception {
        assertLoginFailure(new AuthFailure(401, "AUTHENTICATION_REQUIRED"));
    }

    private void assertLoginFailure(RuntimeException failure) throws Exception {
        AuthenticationManager manager = mock(AuthenticationManager.class);
        when(manager.authenticate(any())).thenThrow(failure);
        var filter = new JsonAuthenticationFilter(manager, mock(AuthRateLimiter.class), errors, mapper);
        var request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setContentType("application/json");
        request.setContent("{\"login\":\"test-account\",\"password\":\"wrong-password\"}"
                .getBytes(StandardCharsets.UTF_8));
        var response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> { throw new AssertionError("Login must terminate the chain"); });

        var body = mapper.readTree(response.getContentAsByteArray());
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(body.path("code").asText()).isEqualTo("INVALID_CREDENTIALS");
        assertThat(body.path("message").asText()).isEqualTo("用户名或密码错误");
        assertThat(body.path("path").asText()).isEqualTo("/api/auth/login");
    }

    @Test void protectedRequestWithoutTokenStillRequiresLogin() throws Exception {
        var decoder = mock(JwtDecoder.class);
        var users = mock(AppUserRepository.class);
        var filter = new JwtAuthenticationFilter(decoder, users, errors, "web-editor", "web-editor-api");
        var request = new MockHttpServletRequest("GET", "/api/auth/me");
        var response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> { throw new AssertionError("Unauthenticated request must stop"); });

        var body = mapper.readTree(response.getContentAsByteArray());
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(body.path("code").asText()).isEqualTo("AUTHENTICATION_REQUIRED");
        assertThat(body.path("message").asText()).isEqualTo("需要登录");
        verifyNoInteractions(decoder, users);
    }
}
