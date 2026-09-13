package com.example.crudspring.websocket;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class JobUpdateHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(JobUpdateHandler.class);

    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
    private volatile String lastPayload = "[]";

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        log.info("[WS] Client connected: {} (total: {})", session.getId(), sessions.size());
        // Send the last known job list immediately so the client doesn't wait 30s
        try {
            session.sendMessage(new TextMessage(lastPayload));
        } catch (Exception e) {
            log.warn("[WS] Failed to send initial payload: {}", e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        log.info("[WS] Client disconnected: {} (total: {})", session.getId(), sessions.size());
    }

    public void broadcast(String json) {
        lastPayload = json;
        TextMessage msg = new TextMessage(json);
        sessions.removeIf(s -> !s.isOpen());
        for (WebSocketSession s : sessions) {
            try {
                s.sendMessage(msg);
            } catch (Exception e) {
                log.warn("[WS] Send failed for session {}: {}", s.getId(), e.getMessage());
                sessions.remove(s);
            }
        }
        if (!sessions.isEmpty()) {
            log.debug("[WS] Broadcast to {} client(s)", sessions.size());
        }
    }

    public int connectedClients() {
        return sessions.size();
    }
}
