import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getInternetCheckState } from "../lib/internet-check.js";

const router = Router();

router.get("/internet/status", requireAuth, (_req, res) => {
  res.json(getInternetCheckState());
});

export default router;
