package com.webeditor.common.exception;

public class RevisionNotFoundException extends RuntimeException {
    public RevisionNotFoundException(String message) {
        super(message);
    }
}
