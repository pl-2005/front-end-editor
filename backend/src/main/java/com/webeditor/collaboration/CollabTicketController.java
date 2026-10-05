package com.webeditor.collaboration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.common.response.ApiResponse;
import com.webeditor.common.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.web.bind.annotation.*;

@RestController
public class CollabTicketController {
    private final CollabTicketService tickets;
    private final CollabInternalAuth auth;
    private final ObjectMapper json;
    public record Consume(String ticket, long projectId, long epoch) {}
    public record Handshake(CollabTicketService.Identity identity, CollabTicketService.Authorization authorization) {}
    public CollabTicketController(CollabTicketService tickets, CollabInternalAuth auth, ObjectMapper json) {
        this.tickets = tickets; this.auth = auth; this.json = json;
    }
    @PostMapping("/api/projects/{id}/collab-ticket")
    public ApiResponse<CollabTicketService.Ticket> issue(@PathVariable long id) {
        return ApiResponse.ok(tickets.issue(id, CurrentUser.id()));
    }
    @PostMapping("/internal/collaboration/tickets/consume")
    public Handshake consume(HttpServletRequest request) throws IOException {
        byte[] body = auth.authenticate(request);
        if (body.length > 4096) throw new CollabFailure(413, "COLLAB_INVALID_REQUEST");
        Consume input = json.readValue(body, Consume.class);
        var identity = tickets.consume(input.ticket(), input.projectId(), input.epoch());
        return new Handshake(identity, tickets.authorization(identity));
    }
    @PostMapping("/internal/collaboration/connections/revalidate")
    public CollabTicketService.Authorization revalidate(HttpServletRequest request) throws IOException {
        byte[] body = auth.authenticate(request);
        if (body.length > 4096) throw new CollabFailure(413, "COLLAB_INVALID_REQUEST");
        return tickets.revalidate(json.readValue(body, CollabTicketService.Authorization.class));
    }
}
