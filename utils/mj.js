// utils/mj.js
//
// Utility functions for generating Mailjet-specific headers with a unique
// custom ID. These headers allow Mailjet's event system to correlate
// delivery, open and click events with messages sent by this server.
//
// It also records an initial "sent" status into the internal data store so
// that emails appear immediately in the tracking UI even before any
// webhook events are received.

import { randomBytes } from 'crypto';
import { upsertStatus } from '../dataStore.js';

/**
 * Build Mailjet headers with a unique CustomID for tracking.
 *
 * The generated ID is composed of the provided prefix, the current
 * timestamp and a random suffix.  Tracking headers for opens and
 * clicks are always enabled.
 *
 * @param {string} prefix Prefix to identify the context of the email
 * (e.g. 'atelier_service_', 'conges_', etc.).
 * @returns {{ id: string, headers: object }} The generated ID and
 * headers to pass to nodemailer.
 */
export function buildMailjetHeaders(prefix = '') {
  // Generate a random hex string to guarantee uniqueness even for
  // simultaneous sends.
  const randomPart = randomBytes(4).toString('hex');
  const id = `${prefix}${Date.now()}_${randomPart}`;
  const headers = {
    'X-MJ-CustomID': id,
    'X-Mailjet-TrackOpen': '1',
    'X-Mailjet-TrackClick': '1'
  };
  try {
    // Register the initial state as 'sent' so it appears in the
    // tracking interface before Mailjet webhook events arrive.
    upsertStatus(id, { state: 'sent' });
  } catch {
    // Ignore failures silently – the datastore may not be initialised
    // during startup or local testing environments.
  }
  return { id, headers };
}