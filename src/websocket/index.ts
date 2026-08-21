import type {IncomingMessage, Server} from "node:http";
import {type RawData, type WebSocket, WebSocketServer} from "ws";
import {
  type ExtendedWebSocketConnection,
  RequestOperationType,
  ResponseOperationType,
  WebSocketPhase,
  type WebSocketRequest,
} from "../interface/websocket";
import {logger} from "../utils/logger";
import {authWebsocketHandler} from "./controllers/auth.controller";
import {eavesdropWebsocketHandler, heartbeatWebsocketHandler} from "./controllers/misc.controller";
import {videoUpdateWebsocketHandler} from "./controllers/music.controller";

export let wssServer: WebSocketServer;

export function setupWebSocketServer() {
  const wss = new WebSocketServer({noServer: true});
  wssServer = wss;
  wss.on("connection", websocketConnectionHandler);
  return wss;
}

function websocketConnectionHandler(ws: ExtendedWebSocketConnection, _req: IncomingMessage) {
  ws.send(
    JSON.stringify({
      op: ResponseOperationType.DECLARE_INTENT,
      d: {
        message: "Waiting for declaration of intent, authenticate or eavesdrop",
      },
    }),
  );
  ws.disconnectTimeout = setTimeout(() => {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "Connection timed out, please try again"},
      }),
    );
    ws.close();
    logger.warn(`Connection timed out for userId: ${ws.userId}`);
  }, 10000);
  ws.phase = WebSocketPhase.DECLARE_INTENT;
  ws.authenticated = false;
  ws.userId = undefined;
  ws.on("message", m => webSocketMessageHandler(ws, m));
  ws.on("error", webSocketErrorHandler);
  ws.on("close", webSocketCloseHandler);
}

async function webSocketMessageHandler(ws: ExtendedWebSocketConnection, message: RawData) {
  const json = JSON.parse(message.toString()) as WebSocketRequest;
  if (json.op !== RequestOperationType.HEARTBEAT) {
    logger.info(`Received message from userId ${ws.userId}: ${message}`);
  }
  const phase = ws.phase;
  const operation = json.op;
  const data = json.d;

  const operations: any = {
    [WebSocketPhase.DECLARE_INTENT]: {
      [RequestOperationType.AUTH]: authWebsocketHandler,
      [RequestOperationType.EAVESDROP]: eavesdropWebsocketHandler,
    },
    [WebSocketPhase.CONNECTED]: {
      [RequestOperationType.VIDEO_UPDATE]: videoUpdateWebsocketHandler,
      [RequestOperationType.HEARTBEAT]: heartbeatWebsocketHandler,
    },
  };

  if (!operations[phase]?.[operation]) {
    logger.warn(`Unknown operation ${operation} in phase ${phase} for userId ${ws.userId}`);
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "Unknown operation"},
      }),
    );
    return;
  }
  try {
    await operations[phase][operation](ws, data);
  } catch (error) {
    logger.error(`Error processing operation ${operation} for userId ${ws.userId}:`, error);
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "An error occurred while processing your request"},
      }),
    );
  }
}

function webSocketErrorHandler(error: Error) {
  logger.error("WebSocket error:", error);
}

function webSocketCloseHandler(ws: ExtendedWebSocketConnection) {
  logger.info(`WebSocket connection closed for userId: ${ws.userId}`);
}

export function addWebsocketUpgradeHandler(server: Server, wss: WebSocketServer) {
  server.on("upgrade", (req: IncomingMessage, socket: any, head: any) => {
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, req);
    });
  });
}

export function findAuthenticatedConnection(userId: number) {
  return Array.from(wssServer.clients).find(client => {
    const eClient = client as ExtendedWebSocketConnection;
    return eClient.userId === userId && eClient.phase === WebSocketPhase.CONNECTED && eClient.authenticated;
  }) as ExtendedWebSocketConnection | undefined;
}
