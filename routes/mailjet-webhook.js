import express from "express";
import { upsertStatus, recordEvent } from "../dataStore.js";

const router = express.Router();

function pickId(evt) {
  return (
    evt?.CustomID ||
    evt?.customid ||
    evt?.customID ||
    evt?.MessageID ||
    evt?.messageID ||
    evt?.mj_message_id ||
    evt?.Message_GUID ||
    evt?.MessageGuid ||
    null
  );
}

function pickTo(evt) {
  return evt?.email || evt?.Email || evt?.to || evt?.To || "";
}

function pickEvent(evt) {
  return String(evt?.event || evt?.Event || "").toLowerCase();
}

function pickTimeIso(evt) {
  if (evt?.time) return new Date(Number(evt.time) * 1000).toISOString();
  if (evt?.Time) return new Date(Number(evt.Time) * 1000).toISOString();
  return new Date().toISOString();
}

router.post("/", async (req, res) => {
  try {
    const payload = req.body;

    const events = Array.isArray(payload) ? payload : [payload];

    for (const evt of events) {
      const id = pickId(evt);
      if (!id) continue;

      const state = pickEvent(evt) || "sent";
      const at = pickTimeIso(evt);

      const patch = {
        id: String(id),
        to: String(pickTo(evt) || ""),
        state,
        lastEventAt: at,
        updatedAt: new Date().toISOString(),
      };

      if (state === "open")  patch.openCount  = (Number(evt?.openCount)  || 0) + 1;
      if (state === "click") patch.clickCount = (Number(evt?.clickCount) || 0) + 1;

      upsertStatus(String(id), patch);
      await recordEvent(evt);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("[mailjet-webhook] error:", e?.message || e);
    return res.sendStatus(200);
  }
});

export default router;
