/**
 * YouTube InnerTube direct stream resolver.
 *
 * Uses YouTube's internal API endpoints with client types that bypass
 * datacenter IP restrictions without requiring cookies or sign-in.
 *
 * Strategy order:
 *   1. TVHTML5_SIMPLY_EMBEDDED_PLAYER — low bot-detection, no auth
 *   2. IOS                            — mobile client, minimal checks
 *   3. ANDROID_CREATOR               — creator client, different quotas
 */

import fetch from "node-fetch";

export interface PipedStreams {
  videoUrl: string;
  audioUrl: string;
  title: string;
}

const INNERTUBE_CLIENTS: Array<{
  name: string;
  clientName: string;
  clientVersion: string;
  apiKey: string;
  headers: Record<string, string>;
}> = [
  {
    name: "tv_embedded",
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    headers: {
      "User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com",
    },
  },
  {
    name: "ios",
    clientName: "IOS",
    clientVersion: "19.29.1",
    apiKey: "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
    headers: {
      "User-Agent": "com.google.ios.youtube/19.29.1 CFNetwork/1408.0.4 Darwin/22.5.0",
      "X-Goog-Api-Format-Version": "2",
    },
  },
  {
    name: "android_creator",
    clientName: "ANDROID_CREATOR",
    clientVersion: "24.45.100",
    apiKey: "AIzaSyD_qjV8zaaUMehtLkrKFgVeSX_Ingsxzj4",
    headers: {
      "User-Agent": "com.google.android.apps.youtube.creator/24.45.100 (Linux; U; Android 11) gzip",
      "X-Goog-Api-Format-Version": "2",
    },
  },
];

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|\/shorts\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function pickBestFormat(
  streamingData: any,
  targetHeight: number
): { videoUrl: string; audioUrl: string } | null {
  const adaptive: any[] = streamingData.adaptiveFormats ?? [];
  const muxed: any[] = streamingData.formats ?? [];

  // Try to find separate video + audio (best quality)
  const videoFormats = adaptive
    .filter((f: any) => f.mimeType?.startsWith("video/mp4") && f.url && !f.mimeType?.includes("vp09"))
    .sort((a: any, b: any) => Math.abs(a.height - targetHeight) - Math.abs(b.height - targetHeight));

  const audioFormats = adaptive
    .filter((f: any) => f.mimeType?.startsWith("audio/mp4") && f.url)
    .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (videoFormats.length && audioFormats.length) {
    return { videoUrl: videoFormats[0].url, audioUrl: audioFormats[0].url };
  }

  // Fallback: muxed format
  const muxedMp4 = muxed
    .filter((f: any) => f.mimeType?.startsWith("video/mp4") && f.url)
    .sort((a: any, b: any) => Math.abs((a.height ?? 0) - targetHeight) - Math.abs((b.height ?? 0) - targetHeight));

  if (muxedMp4.length) {
    return { videoUrl: muxedMp4[0].url, audioUrl: muxedMp4[0].url };
  }

  return null;
}

export async function getPipedStreams(url: string, quality: number = 720): Promise<PipedStreams> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("No se pudo extraer el ID del video de YouTube");

  const errors: string[] = [];

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const body = {
        videoId,
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "en",
            gl: "US",
          },
        },
      };

      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${client.apiKey}&prettyPrint=false`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...client.headers,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: any = await res.json();

      const status = data?.playabilityStatus?.status;
      if (status && status !== "OK") {
        const reason = data?.playabilityStatus?.reason ?? status;
        throw new Error(reason);
      }

      const streamingData = data?.streamingData;
      if (!streamingData) throw new Error("No streamingData in response");

      const picked = pickBestFormat(streamingData, quality);
      if (!picked) throw new Error("No se encontraron formatos de video compatibles");

      const title = data?.videoDetails?.title ?? "";
      return { ...picked, title };

    } catch (e: any) {
      errors.push(`${client.name}: ${e.message?.slice(0, 120)}`);
    }
  }

  throw new Error(`InnerTube fallback falló: ${errors.join(" | ")}`);
}
