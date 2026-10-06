package com.webeditor.collaboration;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/collaboration")
public class CollabControlController {
    private final CollabDeleteService operations;
    private final CollabInternalAuth auth;
    public CollabControlController(CollabDeleteService operations, CollabInternalAuth auth) {
        this.operations = operations; this.auth = auth;
    }
    @GetMapping("/operations/{id}")
    public CollabDeleteService.Operation operation(@PathVariable String id, HttpServletRequest request) throws IOException {
        auth.authenticate(request); return operations.operation(id);
    }
    @GetMapping("/projects/{id}/control")
    public CollabDeleteService.Control control(@PathVariable long id, HttpServletRequest request) throws IOException {
        auth.authenticate(request); return operations.control(id);
    }
}
