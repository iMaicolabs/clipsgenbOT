import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import videoInfoRouter from "./videoInfo";
import webClipsRouter from "./webClips";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(videoInfoRouter);
router.use(webClipsRouter);
router.use(adminRouter);

export default router;
