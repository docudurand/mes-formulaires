import express from 'express';
import axios from 'axios';
import PDFDocument from 'pdfkit';

const router = express.Router();

const APPSCRIPT_URL = process.env.APPSCRIPT_URL;
const APPSCRIPT_KEY = process.env.APPSCRIPT_KEY;

function assertConfig(res) {
  if (!APPSCRIPT_URL || !APPSCRIPT_KEY) {
    console.error('[CONFIG] APPSCRIPT_URL or APPSCRIPT_KEY missing');
    res.status(500).json({ ok: false, error: 'config_missing' });
    return false;
  }
  return true;
}

router.get('/vehicles', async (req, res) => {
  try {
    if (!APPSCRIPT_URL) throw new Error('APPSCRIPT_URL missing');
    const { data } = await axios.get(`${APPSCRIPT_URL}?action=listVehicles`);
    res.json(data);
  } catch (e) {
    console.error('[GET /vehicles]', e.message);
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.get('/stores', async (req, res) => {
  try {
    if (!APPSCRIPT_URL) throw new Error('APPSCRIPT_URL missing');
    const { data } = await axios.get(`${APPSCRIPT_URL}?action=listStores`);
    res.json(data);
  } catch (e) {
    console.error('[GET /stores]', e.message);
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.get('/loans/search', async (req, res) => {
  try {
    if (!APPSCRIPT_URL) throw new Error('APPSCRIPT_URL missing');
    const { immat = '', date = '' } = req.query;
    const qs = new URLSearchParams({ action: 'searchLoans', immat, date }).toString();
    const { data } = await axios.get(`${APPSCRIPT_URL}?${qs}`);
    res.json(data);
  } catch (e) {
    console.error('[GET /loans/search]', e.message);
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.post('/loans', async (req, res) => {
  if (!assertConfig(res)) return;
  try {
    const payload = { action: 'createLoan', key: APPSCRIPT_KEY, data: req.body };
    const resp = await axios.post(APPSCRIPT_URL, payload, { validateStatus: () => true });

    let data = resp.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }

    if (resp.status >= 400) {
      console.error('[POST /loans] Apps Script status', resp.status, data);
      return res.status(502).json({ ok: false, error: 'apps_script_status_'+resp.status, detail: data });
    }

    if (!data || data.ok === undefined) {
      console.warn('[POST /loans] No explicit ok in response, assuming success');
      return res.json({ ok: true, loan_id: (data && data.loan_id) || null });
    }
    if (data.ok === true) return res.json({ ok: true, loan_id: data.loan_id || null });

    console.error('[POST /loans] Script returned error:', data);
    return res.status(400).json(data);
  } catch (e) {
    console.error('[POST /loans]', e);
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
	});

	router.post('/loans/:loan_id/close', async (req, res) => {
  if (!assertConfig(res)) return;
  try {
    const payload = {
      action: 'closeLoan',
      key: APPSCRIPT_KEY,
      data: { ...req.body, loan_id: req.params.loan_id }
    };
    const resp = await axios.post(APPSCRIPT_URL, payload, { validateStatus: () => true });

    let data = resp.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }

    if (resp.status >= 400) {
      console.error('[POST /loans/:id/close] status', resp.status, data);
      return res.status(502).json({ ok: false, error: 'apps_script_status_'+resp.status, detail: data });
    }

    if (!data || data.ok === undefined || data.ok === true) {
      return res.json({ ok: true });
    }

    return res.status(400).json(data);
  } catch (e) {
    console.error('[POST /loans/:id/close]', e);
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.post('/loans/pdf', async (req, res) => {
  try {
    const d = req.body || {};

    const pad2 = n => String(n).padStart(2, '0');
    const parseMaybeDate = v => {
      if (!v && v !== 0) return null;
      if (v instanceof Date) return isNaN(v) ? null : v;
      if (typeof v === 'number') {
        const ms = Math.round((v - 25569) * 86400 * 1000);
        const dt = new Date(ms);
        return isNaN(dt) ? null : dt;
      }
      if (typeof v === 'string') {
        const hh = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (hh) { const dt = new Date(); dt.setHours(+hh[1], +hh[2], 0, 0); return dt; }
        const dt = new Date(v); if (!isNaN(dt)) return dt;
        const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m2) { const dt2 = new Date(+m2[1], +m2[2]-1, +m2[3]); return isNaN(dt2) ? null : dt2; }
      }
      return null;
    };
    const fmtFRDate = v => {
      const dt = parseMaybeDate(v);
      return dt ? `${pad2(dt.getDate())}/${pad2(dt.getMonth()+1)}/${String(dt.getFullYear()).slice(-2)}` : '';
    };
    const fmtFRTime = v => {
      const dt = parseMaybeDate(v);
      return dt ? `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}` : '';
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="FICHE_PRET_${(d.immatriculation || 'vehicule').replace(/\s+/g,'_')}.pdf"`
    );

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(16).text('FICHE PRET VEHICULE DURAND', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).text(`MAGASIN : ${d.magasin_pret || ''}`, { align: 'right' });
    doc.moveDown();

    const line = (label, value, x, y, gap = 130) => {
  doc.font('Helvetica-Bold').fontSize(12).text(label, x, y);
  doc.font('Helvetica').fontSize(12).text(value || '', x + gap, y);
	};

	const col1 = 40, col2 = 300;
	let y = doc.y + 6;

	line('NOM DU CHAUFFEUR :', d.chauffeur_nom || '', col1, y, 180); y += 22;
	line('IMMATRICULATION :', d.immatriculation || '', col1, y); y += 18;

    const SPACING_AFTER_TITLES  = 12;
    const GAP_BETWEEN_DATE_ROWS = 18;
    const GAP_AFTER_TIME_TO_BOX = 56;

    const yBlock  = y + SPACING_AFTER_TITLES;
    line('DATE DEPART :',  fmtFRDate(d.date_depart),  col1, yBlock);
    line('DATE RETOUR :',  fmtFRDate(d.date_retour),  col2, yBlock);

    const yBlock2 = yBlock + GAP_BETWEEN_DATE_ROWS;
    line('HEURE DEPART :', fmtFRTime(d.heure_depart), col1, yBlock2);
    line('HEURE RETOUR :', fmtFRTime(d.heure_retour), col2, yBlock2);

    const x = 40, w = 515, h = 140, mid = x + w / 2;
    const yBox = yBlock2 + GAP_AFTER_TIME_TO_BOX;

    doc.rect(x, yBox, w, h).stroke();
    doc.moveTo(mid, yBox).lineTo(mid, yBox + h).stroke();

    doc.font('Helvetica-Bold').fontSize(12).text('DEPART', x + 5,   yBox - 14);
    doc.font('Helvetica-Bold').fontSize(12).text('RETOUR', mid + 5, yBox - 14);

    doc.font('Helvetica').fontSize(11);
    doc.text('Réceptionnaire\n\nSignature', x + 10, yBox + 15);
    doc.text('Client\n\nSignature',         x + 180, yBox + 15);
    doc.text('Réceptionnaire\n\nSignature', mid + 10, yBox + 15);
    doc.text('Client\n\nSignature',         mid + 180, yBox + 15);

    const yObs = yBox + h + 36;
    doc.font('Helvetica-Bold').fontSize(12).text('OBSERVATIONS :', x, yObs);
    doc.rect(x, yObs + 12, w, 120).stroke();
    if (d.observations) {
      doc.font('Helvetica').fontSize(11)
         .text(String(d.observations), x + 8, yObs + 16, { width: w - 16 });
    }

    doc.end();
  } catch (e) {
    console.error('[POST /loans/pdf]', e);
    res.status(500).end();
  }
});

export default router;