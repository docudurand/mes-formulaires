// utils/mj.js
//
// Utility functions for generating Mailjet-specific headers with a unique
// custom ID. These headers allow Mailjet's event system to correlate
// delivery, open and click events with messages sent by this server.
//
// This helper also records an initial "sent" status into the internal data
// store so that emails appear immediately in the tracking UI even before any
// webhook events are received. It can also store useful metadata (to/subject).

import { randomBytes } from "crypto";
import { upsertStatus } from "../dataStore.js";

/**
 * Build Mailjet headers with a unique CustomID for tracking.
 *
 * @param {string} prefixOrId Prefix or context string used to build an ID
 *   (e.g. "ramasse_", "creation_vl_main_", "conges_request_123").
 * @param {{to?: string, subject?: string}} meta Optional metadata to store
 *   immediately (useful for showing destination/subject before webhook events).
 * @returns {Record<string,string>} Headers to pass to nodemailer.
 */
export function buildMailjetHeaders(prefixOrId = "", meta = {}) {
  const randomPart = randomBytes(4).toString("hex");
  const base = String(prefixOrId || "");
  const id = `${base}${base.endsWith("_") ? "" : "_"}${Date.now()}_${randomPart}`.replace(/^_+/, "");

  const headers = {
    "X-MJ-CustomID": id,
    "X-Mailjet-TrackOpen": "1",
    "X-Mailjet-TrackClick": "1",
  };

  try {
    upsertStatus(id, {
      id,
      state: "sent",
      to: meta?.to ? String(meta.to) : "",
      subject: meta?.subject ? String(meta.subject) : "",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
    });
  } catch {
    // Ignore failures silently – datastore may not be initialised in some envs.
  }

  return headers;
}
