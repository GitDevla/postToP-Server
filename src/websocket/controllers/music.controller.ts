import {VideoQueries} from "../../database/queries/video.queries";
import {
  type ExtendedWebSocketConnection,
  type ListeningData,
  ResponseOperationType,
  type VideoRequestData,
  type VideoResponseData,
  VideoStatus,
} from "../../interface/websocket";
import {MusicService} from "../../services/music.service";
import {VideoService} from "../../services/video.service";
import {logger} from "../../utils/logger";
import {announceSongToEvedroppers} from "./misc.controller";

export function videoUpdateWebsocketHandler(ws: ExtendedWebSocketConnection, data: VideoRequestData) {
  if (!ws.authenticated || ws.userId === undefined) {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "User not authenticated"},
      }),
    );
    logger.error(`User ${ws.userId} attempted to update video without authentication`);
    return;
  }

  const videoStatus = data.status;
  switch (videoStatus) {
    case VideoStatus.STARTED:
      startedListeningToMusicWebsocketHandler(ws, data);
      break;
    case VideoStatus.PLAYING:
    case VideoStatus.PAUSED:
      if (ws.currentlyPlayingData === undefined) return;
      if (ws.currentlyPlayingData.video.isMusic === undefined) return;
      if (ws.currentlyPlayingData.video.isMusic.is_music === false) return;
      ws.currentlyPlayingData.listeningData.currentTime = data.currentTime;
      ws.currentlyPlayingData.listeningData.status = data.status;
      ws.currentlyPlayingData.listeningData.updatedAt = new Date();
      announceSongToEvedroppers(ws.userId);
      break;
    case VideoStatus.ENDED:
      listenedToMusicWebsocketHandler(ws, data);
      break;
    default:
      // assume aborted
      ws.currentlyPlayingData = undefined;
      announceSongToEvedroppers(ws.userId);
      break;
  }
}

async function listenedToMusicWebsocketHandler(ws: ExtendedWebSocketConnection, data: any) {
  if (ws.userId === undefined)
    return ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "User not authenticated"},
      }),
    );
  if (data.watchID === undefined || data.watchID === "") {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "Invalid watchID"},
      }),
    );
    logger.error(`User ${ws.userId} sent invalid watchID`);
    return;
  }
  const videoID = await VideoService.getOrFetch(data.watchID);
  const isMusic = await MusicService.getVideoIsMusic(videoID);
  if (!isMusic.is_music) return;
  if (ws.userId === undefined) {
    logger.error("ws.userId is undefined in listenedToMusicWebsocketHandler");
    return;
  }
  const res = await MusicService.recordListened(data.watchID, ws.userId);
  if (!res) {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "Failed to record listened music"},
      }),
    );
    logger.error(`User ${ws.userId} failed to listen to music`);
    return;
  }
  announceSongToEvedroppers(ws.userId);
  ws.send(
    JSON.stringify({
      op: ResponseOperationType.VIDEO_UPDATE,
      d: {message: "Music listened successfully"},
    }),
  );
  logger.info(`User ${ws.userId} listened to music successfully`);
}

async function startedListeningToMusicWebsocketHandler(ws: ExtendedWebSocketConnection, data: VideoRequestData) {
  if (data.watchID === undefined || data.watchID === "") {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "Invalid watchID"},
      }),
    );
    logger.error(`User ${ws.userId} sent invalid watchID`);
    return;
  }

  if (ws.userId === undefined) {
    ws.send(
      JSON.stringify({
        op: ResponseOperationType.ERROR,
        d: {message: "User not authenticated"},
      }),
    );
    return;
  }
  const videoID = await VideoService.getOrFetch(data.watchID);
  const videoData = await VideoQueries.fetchDataAll(videoID);

  if (!videoData) {
    return;
  }

  const responseVideo: VideoResponseData = {
    watchID: data.watchID,
    title: videoData.title,
    artist: {
      name: videoData.name,
      handle: videoData.yt_id,
    },
    duration: videoData.duration,
    coverImage: `https://i.ytimg.com/vi/${data.watchID}/hqdefault.jpg`,
    // isMusic: isMusic,
    // NER: NER as any,
  };

  ws.send(
    JSON.stringify({
      op: ResponseOperationType.VIDEO_UPDATE,
      d: {
        video: responseVideo,
      },
    }),
  );
  logger.info(`User ${ws.userId} started listening to music successfully`);

  const isMusic = await MusicService.getVideoIsMusic(videoID);
  const userSubmittedIsMusic = await VideoQueries.fetchIsMusicByUser(videoID, ws.userId);
  responseVideo.isMusic = {
    is_music: isMusic.is_music,
    reviewed: isMusic.reviewed,
    user_submission: userSubmittedIsMusic ? userSubmittedIsMusic.is_music : null,
  };
  const listeningData: ListeningData = {
    currentTime: data.currentTime,
    status: data.status,
    updatedAt: new Date(),
  };
  ws.currentlyPlayingData = {
    video: responseVideo,
    listeningData: listeningData,
  };
  updateClientWithMusicData(ws, responseVideo);

  let NER = null;
  if (isMusic.is_music) {
    (async () => {
      // the evesdroppers don't need to wait for genre prediction
      // const genres = await MusicService.getGenres(videoID);
      // responseVideo.genres = genres as any;
      // updateClientWithMusicData(ws, responseVideo);
    })();
    NER = await MusicService.getEntitiesInMusic(videoID);
    responseVideo.NER = NER as any;
    updateClientWithMusicData(ws, responseVideo);
  }

  ws.currentlyPlayingData = {
    video: responseVideo,
    listeningData: listeningData,
  };

  if (!isMusic.is_music) return;

  if (ws.userId === undefined) {
    logger.error("ws.userId is undefined in startedListeningToMusicWebsocketHandler");
    return;
  }

  // remove sensitive data before sending to eavesdroppers
  responseVideo.isMusic.user_submission = null;

  announceSongToEvedroppers(ws.userId);
}

async function updateClientWithMusicData(ws: ExtendedWebSocketConnection, video: VideoResponseData) {
  if (ws.currentlyPlayingData?.video.watchID !== video.watchID) return;
  ws.send(
    JSON.stringify({
      op: ResponseOperationType.VIDEO_UPDATE,
      d: {
        video: video,
      },
    }),
  );
}
