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

// 1) Import liste (QR feuille)
router.post("/import", async (req, res) => {
  try {
    const { magasin, bons, tourneeId } = req.body || {};
    const data = await callGAS("importList", {
      magasin: String(magasin || ""),
      bons: String(bons || ""),
      tourneeId: String(tourneeId || "")
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

// 2) Scan colis -> VALIDE
router.post("/valider", async (req, res) => {
  try {
    const { tourneeId, magasin, livreurId, bon } = req.body || {};
    const data = await callGAS("scanValider", {
      tourneeId: String(tourneeId || ""),
      magasin: String(magasin || ""),
      livreurId: String(livreurId || ""),
      bon: String(bon || "")
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

// 3) Scan colis -> LIVRE
router.post("/livrer", async (req, res) => {
  try {
    const { tourneeId, magasin, livreurId, bon } = req.body || {};
    const data = await callGAS("scanLivrer", {
      tourneeId: String(tourneeId || ""),
      magasin: String(magasin || ""),
      livreurId: String(livreurId || ""),
      bon: String(bon || "")
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

// Dashboard (lecture)
router.get("/dashboard", async (req, res) => {
  try {
    const magasin = String(req.query.magasin || "");
    const data = await callGAS("getDashboard", { magasin });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

// Infos livreur (restants + liste)
router.get("/livreur", async (req, res) => {
  try {
    const { tourneeId, livreurId } = req.query || {};
    const data = await callGAS("getLivreur", {
      tourneeId: String(tourneeId || ""),
      livreurId: String(livreurId || "")
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

export default router;
