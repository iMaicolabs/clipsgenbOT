import { Router } from "express";
import { getVideoInfo } from "../lib/clipProcessor";

const router = Router();

router.get("/video/info", async (req, res) => {
  const url = req.query.url as string;
  if (!url) { res.status(400).json({ error: "url requerida" }); return; }

  try {
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (err: any) {
    res.status(422).json({ error: "No se pudo obtener información del video", details: err.message });
  }
});

export default router;
