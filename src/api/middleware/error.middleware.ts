import type {NextFunction, Request, Response} from "express";
import {z} from "zod";
import {ClientError, ExpectedError} from "../../interface/errors";
import {logger} from "../../utils/logger";

export function processErrorMiddleware(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ClientError) {
    // logger.info(err.message, "Client error:");
    res.status(err.httpCode).json({message: err.message});
    return;
  }
  if (err instanceof ExpectedError) {
    logger.warn({err}, "Expected server error");
    res.status(500).json({message: "Internal Server Error"});
    return;
  }
  if (err instanceof z.ZodError) {
    // logger.info(err.message, "Validation error:");
    res.status(400).json({message: "Invalid request data", details: err.issues});
    return;
  }
  logger.error({err}, "Unexpected error:");
  res.status(500).json({message: "Internal Server Error"});
}
