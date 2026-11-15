const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

const rooms = new Map();

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        let data;

        try {
            data = JSON.parse(message);
        } catch {
            return;
        }

        const { type, room, role } = data;

        if (type === "join") {
            if (!/^\d{6}$/.test(room)) return;

            ws.room = room;
            ws.role = role;

            if (!rooms.has(room)) rooms.set(room, {});
           rooms.get(room)[role] = ws;

// Confirm successful joining
ws.send(JSON.stringify({ type: "joined" }));

const peer = rooms.get(room)[role === "mic" ? "receiver" : "mic"];

            if (peer && peer.readyState === WebSocket.OPEN) {
                peer.send(JSON.stringify({ type: "peer-joined" }));
                ws.send(JSON.stringify({ type: "peer-joined" }));
            }

            return;
        }

        const peers = rooms.get(ws.room);
        const peer = peers?.[ws.role === "mic" ? "receiver" : "mic"];

        if (peer && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify(data));
        }
    });

    ws.on("close", () => {
        const peers = rooms.get(ws.room);
        if (!peers) return;

        if (peers[ws.role] === ws) delete peers[ws.role];

        const peer = peers[ws.role === "mic" ? "receiver" : "mic"];

        if (peer?.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ type: "peer-left" }));
        }

        if (!peers.mic && !peers.receiver) rooms.delete(ws.room);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("NAYAK MIC Started on port " + PORT);
});
