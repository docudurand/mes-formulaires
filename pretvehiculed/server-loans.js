import express from 'express';
import axios from 'axios';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const router = express.Router();

const APPSCRIPT_URL = process.env.APPSCRIPT_URL;
const APPSCRIPT_KEY = process.env.APPSCRIPT_KEY;

function assertConfig(res) {
  if (!APPSCRIPT_URL || !APPSCRIPT_KEY) {
    res.status(500).json({ ok: false, error: 'config_missing' });
    return false;
  }
  return true;
}

router.get('/vehicles', async (_req, res) => {
  try {
    if (!APPSCRIPT_URL) throw new Error('APPSCRIPT_URL missing');
    const { data } = await axios.get(`${APPSCRIPT_URL}?action=listVehicles`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.get('/stores', async (_req, res) => {
  try {
    if (!APPSCRIPT_URL) throw new Error('APPSCRIPT_URL missing');
    const { data } = await axios.get(`${APPSCRIPT_URL}?action=listStores`);
    res.json(data);
  } catch (e) {
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
      return res.status(502).json({ ok: false, error: 'apps_script_status_'+resp.status, detail: data });
    }
    if (!data || data.ok === undefined) {
      return res.json({ ok: true, loan_id: (data && data.loan_id) || null });
    }
    if (data.ok === true) return res.json({ ok: true, loan_id: data.loan_id || null });
    return res.status(400).json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.post('/loans/:loan_id/update', async (req, res) => {
  if (!assertConfig(res)) return;
  try {
    const payload = {
      action: 'updateLoan',
      key: APPSCRIPT_KEY,
      data: { ...req.body, loan_id: req.params.loan_id }
    };
    const resp = await axios.post(APPSCRIPT_URL, payload, { validateStatus: () => true });
    let data = resp.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
    if (resp.status >= 400) {
      return res.status(502).json({ ok: false, error: 'apps_script_status_'+resp.status, detail: data });
    }
    if (!data || data.ok === undefined || data.ok === true) {
      return res.json({ ok: true });
    }
    return res.status(400).json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'apps_script_error', detail: e.message });
  }
});

router.post('/loans/:loan_id/close', async (req, res) => {
  if (!assertConfig(res)) return;
  try {
    const payload = { action: 'closeLoan', key: APPSCRIPT_KEY, data: { ...req.body, loan_id: req.params.loan_id } };
    const resp = await axios.post(APPSCRIPT_URL, payload, { validateStatus: () => true });
    let data = resp.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
    if (resp.status >= 400) {
      return res.status(502).json({ ok: false, error: 'apps_script_status_'+resp.status, detail: data });
    }
    if (!data || data.ok === undefined || data.ok === true) {
      return res.json({ ok: true });
    }
    return res.status(400).json(data);
  } catch (e) {
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
      if (typeof v === 'number') { const ms = Math.round((v - 25569) * 86400 * 1000); const dt = new Date(ms); return isNaN(dt) ? null : dt; }
      if (typeof v === 'string') {
        const hh = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (hh) { const dt = new Date(); dt.setHours(+hh[1], +hh[2], 0, 0); return dt; }
        const dt = new Date(v); if (!isNaN(dt)) return dt;
        const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m2) { const dt2 = new Date(+m2[1], +m2[2]-1, +m2[3]); return isNaN(dt2) ? null : dt2; }
      }
      return null;
    };
    const fmtFRDate = v => { const dt=parseMaybeDate(v); return dt?`${pad2(dt.getDate())}/${pad2(dt.getMonth()+1)}/${String(dt.getFullYear()).slice(-2)}`:''; };
    const fmtFRTime = v => { const dt=parseMaybeDate(v); return dt?`${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`:''; };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="FICHE_PRET_${(d.immatriculation||'vehicule').replace(/\s+/g,'_')}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
    const host  = (req.headers['x-forwarded-host'] || req.headers['host'] || '').toString().split(',')[0];
    const origin = host ? `${proto}://${host}` : '';
    const closeUrl = origin
      ? `${origin}/pret/close.html?loan_id=${encodeURIComponent(d.loan_id || '')}&immat=${encodeURIComponent(d.immatriculation || '')}`
      : `/pret/close.html?loan_id=${encodeURIComponent(d.loan_id || '')}&immat=${encodeURIComponent(d.immatriculation || '')}`;

    const qrDataUrl = await QRCode.toDataURL(closeUrl, { margin: 1, width: 140 });
    const qrBuf = Buffer.from(qrDataUrl.split(',')[1], 'base64');

    doc.font('Helvetica-Bold').fontSize(16).text('FICHE PRÊT VÉHICULE DURAND', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).text(`MAGASIN : ${d.magasin_pret || ''}`, { align: 'right' });
    doc.moveDown();

    doc.image(qrBuf, doc.page.margins.left, doc.page.margins.top, { width: 90 });
    doc.font('Helvetica').fontSize(8).text('Scanner pour clôturer', doc.page.margins.left, doc.page.margins.top + 95, { width: 90, align: 'center' });

    const line = (label, value, x, y, gap = 130) => {
      doc.font('Helvetica-Bold').fontSize(12).text(label, x, y);
      doc.font('Helvetica').fontSize(12).text(value || '', x + gap, y);
    };

    const col1 = 40, col2 = 300;
    let y = doc.y + 6;
    line('NOM DU CHAUFFEUR :', d.chauffeur_nom || '', col1, y, 180); y += 22;
    line('IMMATRICULATION :', d.immatriculation || '', col1, y);      y += 18;

    const SPACING_AFTER_TITLES  = 12;
    const GAP_BETWEEN_DATE_ROWS = 18;
    const GAP_AFTER_TIME_TO_BOX = 56;

    const yBlock  = y + SPACING_AFTER_TITLES;
    line('DATE DÉPART :',  fmtFRDate(d.date_depart),  col1, yBlock);
    line('DATE RETOUR :',  fmtFRDate(d.date_retour),  col2, yBlock);

    const yBlock2 = yBlock + GAP_BETWEEN_DATE_ROWS;
    line('HEURE DÉPART :', fmtFRTime(d.heure_depart), col1, yBlock2);
    line('HEURE RETOUR :', fmtFRTime(d.heure_retour), col2, yBlock2);

    const x = 40, w = 515, box1H = 120, mid = x + w / 2;
    const yBox1 = yBlock2 + GAP_AFTER_TIME_TO_BOX;

    doc.rect(x, yBox1, w, box1H).stroke();
    doc.moveTo(mid, yBox1).lineTo(mid, yBox1 + box1H).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('DÉPART', x + 5,   yBox1 - 14);
    doc.font('Helvetica-Bold').fontSize(12).text('RETOUR', mid + 5, yBox1 - 14);

    doc.font('Helvetica').fontSize(11);
    doc.text('Réceptionnaire\n\nSignature', x + 10,  yBox1 + 18);
    doc.text('Réceptionnaire\n\nSignature', mid + 10, yBox1 + 18);

    const gapBetweenBoxes = 20;
    const box2H = 100;
    const yBox2 = yBox1 + box1H + gapBetweenBoxes;

    doc.rect(x, yBox2, w, box2H).stroke();
    doc.moveTo(mid, yBox2).lineTo(mid, yBox2 + box2H).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('DÉPART (CONDUCTEUR)', x + 5,   yBox2 - 14);
    doc.font('Helvetica-Bold').fontSize(12).text('RETOUR (CONDUCTEUR)', mid + 5, yBox2 - 14);

    doc.font('Helvetica').fontSize(11);
    doc.text('Conducteur\n\nSignature', x + 10,  yBox2 + 18);
    doc.text('Conducteur\n\nSignature', mid + 10, yBox2 + 18);

    const yObs = yBox2 + box2H + 36;
    doc.font('Helvetica-Bold').fontSize(12).text('OBSERVATIONS :', x, yObs);
    doc.rect(x, yObs + 12, w, 120).stroke();
    if (d.observations) {
      doc.font('Helvetica').fontSize(11).text(String(d.observations), x + 8, yObs + 16, { width: w - 16 });
    }

    doc.end();
  } catch (e) {
    res.status(500).end();
  }
});

router.post('/loans/print', async (req, res) => {
  try {
    const d = req.body || {};
    const pad2 = n => String(n).padStart(2,'0');
    const parseMaybeDate = v => {
      if (!v && v !== 0) return null;
      if (v instanceof Date) return isNaN(v) ? null : v;
      if (typeof v === 'number') { const ms = Math.round((v-25569)*86400*1000); const dt=new Date(ms); return isNaN(dt)?null:dt; }
      if (typeof v === 'string') {
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)){ const[h,m]=v.split(':'); const dt=new Date();dt.setHours(+h,+m||0,0,0);return dt; }
        const dt = new Date(v); if (!isNaN(dt)) return dt;
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(m){ const dt2=new Date(+m[1],+m[2]-1,+m[3]); return isNaN(dt2)?null:dt2; }
      }
      return null;
    };
    const fmtDate = v => { const dt=parseMaybeDate(v); return dt ? `${pad2(dt.getDate())}/${pad2(dt.getMonth()+1)}/${String(dt.getFullYear()).slice(-2)}` : ''; };
    const fmtTime = v => { const dt=parseMaybeDate(v); return dt ? `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}` : ''; };

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
    const host  = (req.headers['x-forwarded-host'] || req.headers['host'] || '').toString().split(',')[0];
    const origin = host ? `${proto}://${host}` : (process.env.PUBLIC_BASE_URL || '');
    const closeUrl = `${origin}/pret/close.html?loan_id=${encodeURIComponent(d.loan_id || '')}&immat=${encodeURIComponent(d.immatriculation || '')}`;
    const qrDataUrl = await QRCode.toDataURL(closeUrl, { margin: 1, width: 110 });

    const esc = s => String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fiche prêt ${esc(d.immatriculation)}</title>
<style>
@page{ size:A4; margin:12mm }
body{ font-family:Arial,Helvetica,sans-serif; color:#111; }
.header{ display:flex; justify-content:space-between; align-items:flex-start; }
.qrcode{ width:110px; height:110px; }
h1{ margin:0 0 8px; font-size:18px; text-align:center }
.grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 24px; margin-top:8px }
.label{ font-weight:700 }
.box{ border:1px solid #222; height:120px; margin-top:18px; display:grid; grid-template-columns:1fr 1fr; }
.box h3{ margin: -10px 0 4px 8px; font-size:14px }
.cell{ padding:12px; border-right:1px solid #222 }
.cell:last-child{ border-right:0 }
.obs{ margin-top:20px }
.area{ border:1px solid #222; height:120px; padding:8px; white-space:pre-wrap }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>FICHE PRÊT VÉHICULE DURAND</h1>
      <div>MAGASIN : <strong>${esc(d.magasin_pret)}</strong></div>
    </div>
    <img class="qrcode" alt="QR clôture" src="${qrDataUrl}">
  </div>

  <div class="grid" style="margin-top:10px">
    <div><span class="label">NOM DU CHAUFFEUR : </span>${esc(d.chauffeur_nom)}</div>
    <div><span class="label">IMMATRICULATION : </span>${esc(d.immatriculation)}</div>
    <div><span class="label">DATE DÉPART : </span>${fmtDate(d.date_depart)}</div>
    <div><span class="label">DATE RETOUR : </span>${fmtDate(d.date_retour)}</div>
    <div><span class="label">HEURE DÉPART : </span>${fmtTime(d.heure_depart)}</div>
    <div><span class="label">HEURE RETOUR : </span>${fmtTime(d.heure_retour)}</div>
  </div>

  <div class="box">
    <div class="cell">
      <h3>DÉPART</h3>
      Réceptionnaire<br><br>Signature
    </div>
    <div class="cell">
      <h3>RETOUR</h3>
      Réceptionnaire<br><br>Signature
    </div>
  </div>

  <div class="box">
    <div class="cell">
      <h3>DÉPART (CONDUCTEUR)</h3>
      Conducteur<br><br>Signature
    </div>
    <div class="cell">
      <h3>RETOUR (CONDUCTEUR)</h3>
      Conducteur<br><br>Signature
    </div>
  </div>

  <div class="obs">
    <div class="label">OBSERVATIONS :</div>
    <div class="area">${esc(d.observations)}</div>
  </div>

  <script>window.onload=()=>{ setTimeout(()=>window.print(), 100); };</script>
</body></html>`;

    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('<h1>Erreur</h1>');
  }
});

export default router;