const express = require('express');
interims: [{nom:'PEREZ'}],
livreurs: {
'WARNING': ['Matin','A. Midi'],
'NAVETTE NUIT ALL COURS': ['NUIT'],
'C CHEZ VOUS': ['10H','12H','16H']
}
});
});


// 2) Enregistrer la saisie du jour => fichier mensuel /<YYYY-MM>/<MAGASIN>.json
router.post('/save', express.json({limit:'2mb'}), async (req,res)=>{
try{
const { magasin, date, data } = req.body||{};
if(!magasin || !date) return res.status(400).json({error:'missing fields'});
const remoteDir = `${FTP_ROOT}/${yyyymm(date)}`;
const remoteFile = `${remoteDir}/${magasin}.json`;


const client = await ftpClient();
const json = await readJSONIfExists(client, remoteFile) || {};
json[date] = { data, savedAt: new Date().toISOString() };
await writeJSON(client, remoteFile, json);
client.close();
res.json({ok:true});
}catch(e){
console.error('save error', e);
res.status(500).json({error:'save_failed'});
}
});


// 3) Lire la saisie d’un jour (prefill)
router.get('/day', async (req,res)=>{
const { magasin, date } = req.query;
if(!magasin || !date) return res.status(400).json({error:'missing fields'});
const client = await ftpClient();
const remoteFile = `${FTP_ROOT}/${yyyymm(date)}/${magasin}.json`;
const json = await readJSONIfExists(client, remoteFile);
client.close();
res.json(json?.[date] || {});
});


// 4) Résumé mensuel pour tous les magasins
router.get('/month', async (req,res)=>{
const yyyymm = String(req.query.yyyymm||'');
if(!yyyymm) return res.status(400).json({error:'missing yyyymm'});
const client = await ftpClient();


const files = {}; // par magasin => map day => record
for(const m of MAGASINS){
const json = await readJSONIfExists(client, `${FTP_ROOT}/${yyyymm}/${m}.json`);
if(json) files[m] = json; else files[m] = {};
}

const personnel = {};
for(const m of MAGASINS){
try{
if(process.env.GS_PRESENCES_URL){
const resp = await fetch(`${process.env.GS_PRESENCES_URL}?action=personnel&magasin=${encodeURIComponent(m)}`);
if(resp.ok) personnel[m] = await resp.json(); else personnel[m] = {employes:[], interims:[], livreurs:{}};
} else {
personnel[m] = {employes:[], interims:[], livreurs:{}};
}
}catch(_){ personnel[m] = {employes:[], interims:[], livreurs:{}}; }
}


client.close();
res.json({ yyyymm, files, personnel });
});


module.exports = router;