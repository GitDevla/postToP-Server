import {WebSocket} from "ws";
import {UserQueries} from "../../database/queries/user.queries";
import {type ExtendedWebSocketConnection, ResponseOperationType, WebSocketPhase} from "../../interface/websocket";
import {logger} from "../../utils/logger";
import {findAuthenticatedConnection, wssServer} from "..";

export function heartbeatWebsocketHandler(ws: ExtendedWebSocketConnection, _data: any) {
  if (!ws.authenticated || ws.userId === undefined) {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "User not authenticated"},
      }),
    );
    return;
  }

  ws.send(
    JSON.stringify({
      op: ResponseOperationType.HEARTBEAT,
    }),
  );
}

// TODO: Replace this with some kind of event system or pub/sub pattern
// but this is fine for now
export function announceSongToEvedroppers(userID: number) {
  const originalWS = findAuthenticatedConnection(userID);

  let data;
  if (
    originalWS === undefined ||
    originalWS.currentlyPlayingData === undefined ||
    originalWS.currentlyPlayingData.video.isMusic === undefined ||
    originalWS.currentlyPlayingData.video.isMusic.is_music === false
  ) {
    data = {
      userId: userID,
      video: null,
      listeningData: null,
    };
  } else {
    data = {
      userId: userID,
      video: originalWS.currentlyPlayingData.video,
      listeningData: originalWS.currentlyPlayingData.listeningData,
    };
  }

  for (const client of wssServer.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const eClient = client as ExtendedWebSocketConnection;
    if (eClient.phase !== WebSocketPhase.CONNECTED) continue;
    if (eClient.userId !== userID) continue;
    if (eClient.authenticated) continue;
    client.send(
      JSON.stringify({
        op: ResponseOperationType.VIDEO_UPDATE,
        d: data,
      }),
    );
  }
  logger.info(`Announced song update by user ${userID} to eavesdroppers`);
}

export async function eavesdropWebsocketHandler(ws: ExtendedWebSocketConnection, data: any) {
  clearTimeout(ws.disconnectTimeout);
  const user = await UserQueries.fetchBy(data.handle, "handle");

  if (!user) {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "User not found"},
      }),
    );
    logger.error(`Eavesdrop attempt failed for handle ${data.handle}: User not found`);
    return;
  }

  ws.phase = WebSocketPhase.CONNECTED;
  ws.userId = user.id;
  ws.send(
    JSON.stringify({
      op: ResponseOperationType.EAVESDROPPED,
      d: {message: "Eavesdropping started"},
    }),
  );
  const originalWS = findAuthenticatedConnection(ws.userId);
  if (!originalWS?.currentlyPlayingData) return;
  if (
    originalWS.currentlyPlayingData.video.isMusic === undefined ||
    originalWS.currentlyPlayingData.video.isMusic.is_music === false
  )
    return;
  ws.send(
    JSON.stringify({
      op: ResponseOperationType.VIDEO_UPDATE,
      d: {
        userId: ws.userId,
        video: originalWS.currentlyPlayingData.video,
        listeningData: originalWS.currentlyPlayingData.listeningData,
      },
    }),
  );
  logger.info(`User ${ws.userId} started eavesdropping`);
}
