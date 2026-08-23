import type {IncomingMessage, Server} from "node:http";
import {type RawData, WebSocket, WebSocketServer} from "ws";
import {
  type CurrentlyPlaying,
  type ExtendedWebSocketConnection,
  RequestOperationType,
  ResponseOperationType,
  VideoStatus,
  WebSocketPhase,
  type WebSocketRequest,
} from "../interface/websocket";
import {logger} from "../utils/logger";
import {authWebsocketHandler} from "./controllers/auth.controller";
import {
  announceSongToEvedroppers,
  eavesdropWebsocketHandler,
  heartbeatWebsocketHandler,
} from "./controllers/misc.controller";
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
  ws.on("close", () => webSocketCloseHandler(ws));
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
    logger.error({err: error}, `Error processing operation ${operation} for userId ${ws.userId}`);
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "An error occurred while processing your request"},
      }),
    );
  }
}

function webSocketErrorHandler(error: Error) {
  logger.error({err: error}, "WebSocket error");
}

function webSocketCloseHandler(ws: ExtendedWebSocketConnection) {
  clearTimeout(ws.disconnectTimeout);
  clearTimeout(ws.idleTimeout);
  if (ws.authenticated && ws.userId !== undefined) announceSongToEvedroppers(ws.userId);
  logger.info(`WebSocket connection closed for userId: ${ws.userId}`);
}

export function addWebsocketUpgradeHandler(server: Server, wss: WebSocketServer) {
  server.on("upgrade", (req: IncomingMessage, socket: any, head: any) => {
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, req);
    });
  });
}

export function findNowPlaying(userId: number): CurrentlyPlaying | undefined {
  let best: CurrentlyPlaying | undefined;
  for (const client of wssServer.clients) {
    const eClient = client as ExtendedWebSocketConnection;
    if (eClient.readyState !== WebSocket.OPEN) continue;
    if (eClient.userId !== userId) continue;
    if (eClient.phase !== WebSocketPhase.CONNECTED || !eClient.authenticated) continue;
    const playing = eClient.currentlyPlayingData;
    if (!playing?.video.isMusic?.is_music) continue;
    if (best === undefined || outranks(playing, best)) best = playing;
  }
  return best;
}

function outranks(candidate: CurrentlyPlaying, current: CurrentlyPlaying) {
  if (isRunning(candidate) !== isRunning(current)) return isRunning(candidate);
  return new Date(candidate.listeningData.updatedAt) > new Date(current.listeningData.updatedAt);
}

function isRunning({listeningData}: CurrentlyPlaying) {
  return listeningData.status === VideoStatus.PLAYING || listeningData.status === VideoStatus.STARTED;
}
