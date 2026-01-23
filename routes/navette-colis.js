import express from "express";
import axios from "axios";

const router = express.Router();

function mustEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function callGAS(action, params) {
  const url = mustEnv("NAVETTE_GAS_URL");
  const key = mustEnv("NAVETTE_API_KEY");

  const payload = new URLSearchParams({ action, key, ...params });

  const { data } = await axios.post(url, payload.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000
  });

  return data;
}

router.post("/import", async (req, res) => {
  try {
    const { magasin, bons, tourneeId, tournee, codeTournee } = req.body || {};
    const data = await callGAS("importList", {
      magasin: String(magasin || ""),
      bons: String(bons || ""),
      tourneeId: String(tourneeId || ""),
      tournee: String(tournee || ""),
      codeTournee: String(codeTournee || "")
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

router.post("/valider", async (req, res) => {
  try {
    const { tourneeId, magasin, livreurId, bon, tournee, codeTournee, gpsLat, gpsLng, gpsAcc, gpsTs } = req.body || {};
    const data = await callGAS("scanValider", {
      tourneeId: String(tourneeId || ""),
      magasin: String(magasin || ""),
      livreurId: String(livreurId || ""),
      bon: String(bon || ""),
      tournee: String(tournee || ""),
      codeTournee: String(codeTournee || ""),
      gpsLat: gpsLat === undefined ? "" : String(gpsLat),
      gpsLng: gpsLng === undefined ? "" : String(gpsLng),
      gpsAcc: gpsAcc === undefined ? "" : String(gpsAcc),
      gpsTs: gpsTs === undefined ? "" : String(gpsTs)
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

router.post("/livrer", async (req, res) => {
  try {
    const { tourneeId, magasin, livreurId, bon, tournee, codeTournee, gpsLat, gpsLng, gpsAcc, gpsTs } = req.body || {};
    const data = await callGAS("scanLivrer", {
      tourneeId: String(tourneeId || ""),
      magasin: String(magasin || ""),
      livreurId: String(livreurId || ""),
      bon: String(bon || ""),
      tournee: String(tournee || ""),
      codeTournee: String(codeTournee || ""),
      gpsLat: gpsLat === undefined ? "" : String(gpsLat),
      gpsLng: gpsLng === undefined ? "" : String(gpsLng),
      gpsAcc: gpsAcc === undefined ? "" : String(gpsAcc),
      gpsTs: gpsTs === undefined ? "" : String(gpsTs)
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

router.get("/active", async (req, res) => {
  try {
    const magasin = String(req.query.magasin || "");
    const data = await callGAS("getActiveTournee", { magasin });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

router.get("/magasins", async (req, res) => {
  try {
    const data = await callGAS("getMagasins", {});
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    const magasin = String(req.query.magasin || "");
    const data = await callGAS("getDashboard", { magasin });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});


router.get("/livreur", async (req, res) => {
  try {
    const { tourneeId, magasin, livreurId } = req.query || {};
    const data = await callGAS("getLivreur", {
      tourneeId: String(tourneeId || ""),
      magasin: String(magasin || ""),
      livreurId: String(livreurId || "")
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

export default router;
