import {json, urlencoded} from "body-parser";
import cors from "cors";
import express from "express";
import "express-async-errors";
import swaggerUi from "swagger-ui-express";
import {swaggerSpec} from "../../utils/swagger";
import {getIsMusicAiProxyController, getNERAIProxyController} from "../controllers/ai.controller";
import {authRequestHandler, registerRequestHandler} from "../controllers/auth.controller";
import {getNowPlayingBadgeController} from "../controllers/badge.controller";
import {
  deleteGenreReviewRequestHandler,
  deleteIsMusicReviewRequestHandler,
  deleteNERReviewRequestHandler,
  getAdminActivityLogsController,
  postGenreReviewRequestHandler,
  postIsMusicReviewRequestHandler,
  postNERReviewRequestHandler,
} from "../controllers/review.controller";
import {getServerStatsController} from "../controllers/stat.controller";
import {
  deleteUserController,
  getUserHistoryController,
  getUserInfoController,
  getUserStatisticsController,
  getUserStatsController,
  updateUserInfoController,
} from "../controllers/user.controller";
import {getVideosController} from "../controllers/video.controller";
import {getYoutubeArtistChannelController} from "../controllers/youtube.controller";
import {adminMiddleware} from "../middleware/admin.middleware";
import {authMiddleware} from "../middleware/auth.middleware";
import {processErrorMiddleware} from "../middleware/error.middleware";
import {logRequestMiddleware} from "../middleware/logger.middleware";

export function setupAPIRoutes() {
  const app = express();
  app.options("*", cors());
  app.use(cors());
  app.use(
    urlencoded({
      extended: true,
    }),
  );
  app.use(json());
  app.use(logRequestMiddleware);
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.get("/ai/is-music", getIsMusicAiProxyController);
  app.get("/ai/ner", getNERAIProxyController);

  app.post("/auth", authRequestHandler);
  app.post("/register", registerRequestHandler);
  app.post("/review/music", authMiddleware, postIsMusicReviewRequestHandler);
  app.delete("/review/music", authMiddleware, deleteIsMusicReviewRequestHandler);
  app.post("/review/ner", authMiddleware, postNERReviewRequestHandler);
  app.delete("/review/ner", authMiddleware, deleteNERReviewRequestHandler);
  app.post("/review/genre", authMiddleware, postGenreReviewRequestHandler);
  app.delete("/review/genre", authMiddleware, deleteGenreReviewRequestHandler);
  app.get("/user/:handle/now-playing.svg", getNowPlayingBadgeController);
  app.get("/user/:handle/top", getUserStatisticsController);
  app.get("/user/:handle", getUserInfoController);
  app.put("/user/:handle", authMiddleware, updateUserInfoController);
  app.delete("/user/:handle", authMiddleware, deleteUserController);
  app.get("/user/:handle/history", getUserHistoryController);
  app.get("/user/:handle/stats", getUserStatsController);
  app.get("/videos", getVideosController);
  app.get("/youtube/artist-channel", authMiddleware, getYoutubeArtistChannelController);
  app.get("/stats", getServerStatsController);
  app.get("/admin/activity-logs", authMiddleware, adminMiddleware, getAdminActivityLogsController);

  app.use(processErrorMiddleware);
  return app;
}
