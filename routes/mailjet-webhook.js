import express from "express";
import { upsertStatus, recordEvent } from "../dataStore.js";

const router = express.Router();

router.post("/", async (req,res)=>{
  const e = req.body;
  const id = e.CustomID || e.MessageID;
  if(!id) return res.sendStatus(200);

  const patch = {
    to: e.email,
    state: e.event,
    sentAt: e.time ? new Date(e.time*1000).toISOString() : undefined
  };

  upsertStatus(id, patch);
  await recordEvent(e);
  res.sendStatus(200);
});

export default router;