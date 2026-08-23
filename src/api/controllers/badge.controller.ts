import type {Request, Response} from "express";
import {UserQueries} from "../../database/queries/user.queries";
import {InvalidUserError} from "../../interface/errors";
import {BadgeService} from "../../services/badge.service";
import {findNowPlaying} from "../../websocket";

export async function getNowPlayingBadgeController(req: Request, res: Response) {
  const user = await UserQueries.fetchBy(req.params.handle, "handle");
  if (!user) throw new InvalidUserError("User not found");

  const transparent = ["", "1", "true"].includes(String(req.query.transparent));
  const svg = await BadgeService.renderNowPlaying(findNowPlaying(user.id), transparent);

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
  return res.status(200).send(svg);
}
