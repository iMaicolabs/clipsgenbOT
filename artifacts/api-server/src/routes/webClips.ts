import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { db, clipsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  jobs,
  jobEmitter,
  processClipJob,
  CLIPS_DIR,
  type ClipJob,
} from "../lib/clipProcessor";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

const createClipSchema = z.object({
  url: z.string().url(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  startStr: z.string(),
  endStr: z.string(),
  quality: z.enum(["360", "480", "720", "1080"]).default("720"),
  save: z.boolean().default(false),
  videoTitle: z.string().optional(),
  videoThumbnail: z.string().optional(),
});

router.post("/web-clips", optionalAuth as any, async (req: AuthRequest, res) => {
  const parsed = createClipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Parámetros inválidos", details: parsed.error.issues });
    return;
  }
  const { url, startSec, endSec, startStr, endStr, quality, save, videoTitle, videoThumbnail } = parsed.data;

  if (endSec <= startSec) {
    res.status(400).json({ error: "El tiempo de fin debe ser mayor que el de inicio" });
    return;
  }
  if (endSec - startSec > 900) {
    res.status(400).json({ error: "El clip no puede durar más de 15 minutos" });
    return;
  }

  const jobId = randomUUID();
  const job: ClipJob = {
    id: jobId,
    status: "pending",
    progress: 0,
    progressMsg: "En cola...",
  };
  jobs.set(jobId, job);

  let dbClipId: number | undefined;
  if (req.userId && save) {
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [clip] = await db.insert(clipsTable).values({
        userId: req.userId,
        youtubeUrl: url,
        videoTitle: videoTitle ?? null,
        videoThumbnail: videoThumbnail ?? null,
        startSec,
        endSec,
        startStr,
        endStr,
        quality,
        status: "processing",
        expiresAt,
      }).returning();
      dbClipId = clip.id;
    } catch (e) {
      logger.warn({ e }, "Failed to create DB clip record");
    }
  }

  processClipJob(jobId, url, startSec, endSec, quality).then(async () => {
    const done = jobs.get(jobId);
    if (dbClipId && done) {
      try {
        await db.update(clipsTable).set({
          status: done.status,
          filePath: done.filePath,
          sizeBytes: done.sizeBytes,
          errorMsg: done.error,
        }).where(eq(clipsTable.id, dbClipId));
      } catch (e) {
        logger.warn({ e }, "Failed to update DB clip record");
      }
    }
  });

  res.json({ jobId, dbClipId });
});

router.get("/web-clips/job/:jobId/events", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if ((res as any).flush) (res as any).flush();
  };

  if (!job) {
    send({ status: "error", error: "Job no encontrado" });
    res.end();
    return;
  }

  send({ ...job });

  if (job.status === "done" || job.status === "error") {
    res.end();
    return;
  }

  const handler = (data: any) => {
    send(data);
    if (data.status === "done" || data.status === "error") {
      res.end();
      jobEmitter.off(`progress:${jobId}`, handler);
    }
  };

  jobEmitter.on(`progress:${jobId}`, handler);
  req.on("close", () => {
    jobEmitter.off(`progress:${jobId}`, handler);
  });
});

router.get("/web-clips/job/:jobId/download", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job || job.status !== "done" || !job.filePath) {
    res.status(404).json({ error: "Clip no disponible" });
    return;
  }

  if (!fs.existsSync(job.filePath)) {
    res.status(410).json({ error: "El clip ha expirado" });
    return;
  }

  const filename = `clip_${jobId.slice(0, 8)}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");
  const stat = fs.statSync(job.filePath);
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(job.filePath).pipe(res);
});

router.get("/web-clips/db/:dbClipId/download", requireAuth as any, async (req: AuthRequest, res) => {
  const dbClipId = parseInt(req.params.dbClipId);
  if (isNaN(dbClipId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [clip] = await db.select().from(clipsTable).where(
    and(eq(clipsTable.id, dbClipId), eq(clipsTable.userId, req.userId!))
  ).limit(1);

  if (!clip) { res.status(404).json({ error: "Clip no encontrado" }); return; }
  if (!clip.filePath || !fs.existsSync(clip.filePath)) {
    res.status(410).json({ error: "El clip ha expirado" });
    return;
  }

  const filename = `clip_${dbClipId}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");
  const stat = fs.statSync(clip.filePath);
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(clip.filePath).pipe(res);
});

router.get("/web-clips", requireAuth as any, async (req: AuthRequest, res) => {
  const clips = await db.select().from(clipsTable)
    .where(eq(clipsTable.userId, req.userId!))
    .orderBy(desc(clipsTable.createdAt))
    .limit(50);

  const now = new Date();
  const withAvailability = clips.map((c) => ({
    ...c,
    fileAvailable: !!c.filePath && !!c.expiresAt && c.expiresAt > now && fs.existsSync(c.filePath ?? ""),
  }));

  res.json(withAvailability);
});

router.delete("/web-clips/:id", requireAuth as any, async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [clip] = await db.select().from(clipsTable).where(
    and(eq(clipsTable.id, id), eq(clipsTable.userId, req.userId!))
  ).limit(1);

  if (!clip) { res.status(404).json({ error: "Clip no encontrado" }); return; }

  if (clip.filePath && fs.existsSync(clip.filePath)) {
    try { fs.unlinkSync(clip.filePath); } catch {}
  }

  await db.delete(clipsTable).where(eq(clipsTable.id, id));
  res.json({ ok: true });
});

export default router;
