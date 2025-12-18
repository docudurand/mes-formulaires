import express from "express";
import { listStatus } from "../dataStore.js";
const router = express.Router();

router.get("/email-status", (_req,res)=>{
  res.json(listStatus());
});

export default router;