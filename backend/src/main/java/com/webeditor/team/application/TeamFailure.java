package com.webeditor.team.application;

public class TeamFailure extends RuntimeException {
    private final int status;
    private final String code;
    public TeamFailure(int status, String code, String message) {
        super(message); this.status = status; this.code = code;
    }
    public int status() { return status; }
    public String code() { return code; }
}
