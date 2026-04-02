import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.endsWith(".replit.dev") || origin.endsWith(".replit.app")) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
