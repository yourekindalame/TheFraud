import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    autoConnect: true,
    transports: ["websocket", "polling"]
  });
  return socket;
}

