package com.webeditor.common.security;

import com.webeditor.identity.application.AuthFailure;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class AuthCookie {
    public static final String NAME = "web_editor_refresh";
    private final boolean secure;
    public AuthCookie(@Value("${editor.auth.cookie-secure:true}") boolean secure) { this.secure = secure; }
    public String read(HttpServletRequest request) {
        String token = null;
        if (request.getCookies() != null) for (var cookie : request.getCookies()) {
            if (!NAME.equals(cookie.getName())) continue;
            if (token != null) throw new AuthFailure(401, "AUTHENTICATION_REQUIRED");
            token = cookie.getValue();
        }
        return token;
    }
    public void write(HttpServletResponse response, String token, long seconds) {
        response.addHeader("Set-Cookie", ResponseCookie.from(NAME, token).httpOnly(true)
                .secure(secure).sameSite("Strict").path("/api/auth").maxAge(seconds).build().toString());
    }
    public void clear(HttpServletResponse response) { write(response, "", 0); }
}
