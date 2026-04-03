import { Router } from "express";
import fetch from "node-fetch";

const router = Router();

interface OEmbedResponse {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

function parseIso8601Duration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0") * 3600) + (parseInt(m[2] ?? "0") * 60) + parseInt(m[3] ?? "0");
}

function normalizeYouTubeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
    }
    if (u.pathname.startsWith("/shorts/")) {
      return `https://www.youtube.com/watch?v=${u.pathname.replace("/shorts/", "")}`;
    }
    return url;
  } catch {
    return url;
  }
}

router.get("/video/info", async (req, res) => {
  const rawUrl = req.query.url as string;
  if (!rawUrl) { res.status(400).json({ error: "url requerida" }); return; }

  const url = normalizeYouTubeUrl(rawUrl);

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

    const [oembedRes, pageRes] = await Promise.allSettled([
      fetch(oembedUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; bot)" },
      }),
    ]);

    if (oembedRes.status === "rejected" || !oembedRes.value.ok) {
      res.status(422).json({ error: "No se pudo obtener información del video. Verifica que el link sea válido y el video sea público." });
      return;
    }

    const oembed = await oembedRes.value.json() as OEmbedResponse;

    let duration = 0;
    if (pageRes.status === "fulfilled" && pageRes.value.ok) {
      const html = await pageRes.value.text();
      const durationMatch = html.match(/"approxDurationMs":"(\d+)"/);
      if (durationMatch) {
        duration = Math.round(parseInt(durationMatch[1]) / 1000);
      } else {
        const isoMatch = html.match(/itemprop="duration"\s+content="([^"]+)"/);
        if (isoMatch) duration = parseIso8601Duration(isoMatch[1]);
      }
    }

    res.json({
      title: oembed.title,
      thumbnail: oembed.thumbnail_url.replace("hqdefault", "maxresdefault"),
      duration,
      uploader: oembed.author_name,
    });
  } catch (err: any) {
    res.status(422).json({ error: "No se pudo obtener información del video", details: err.message });
  }
});

export default router;
