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
    const magasin = String((req.query && req.query.magasin) || "").trim().toUpperCase();
    const tourneeId = String((req.query && req.query.tourneeId) || "").trim();
    const livreurId = String((req.query && req.query.livreurId) || "").trim();

    if (!magasin || !livreurId) {
      return res.status(400).json({ success:false, error: "magasin/livreurId manquant" });
    }

    // tourneeId optionnel : si absent, GAS choisit la tournée active (fenêtre 45 min)
    const payload = { magasin, livreurId };
    if (tourneeId) payload.tourneeId = tourneeId;

    const data = await callGAS("getLivreur", payload);
    res.json(data);
  } catch (e) {
    res.status(500).json({ success:false, error: String(e.message || e) });
  }
});

export default router;
