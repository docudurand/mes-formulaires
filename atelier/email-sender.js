// Module d'envoi d'emails pour le module atelier
import { transporter, fromEmail } from "../mailer.js";

// Mapping des services vers les emails des responsables
function getEmailForService(service) {
  const serviceKey = String(service || "").trim().toUpperCase();
  
  const mapping = {
    // Rectification Culasse
    "RECTIFICATION CULASSE": process.env.DEST_EMAIL_ATELIER_CULASSE,
    
    // Rectification Vilebrequin (pas de variable spécifique mentionnée)
    "RECTIFICATION VILEBREQUIN": process.env.DEST_EMAIL_ATELIER_CULASSE, // Même email que culasse ?
    
    // Services Chasse (Volant + Machoires)
    "RECTIFICATION DES VOLANTS MOTEUR": process.env.DEST_EMAIL_ATELIER_CHASSE,
    "REGARNISSAGES MACHOIRES": process.env.DEST_EMAIL_ATELIER_CHASSE,
    
    // Injection Diesel
    "CONTRÔLE INJECTION DIESEL": process.env.DEST_EMAIL_ATELIER_DIESEL,
    "CONTROLE INJECTION DIESEL": process.env.DEST_EMAIL_ATELIER_DIESEL,
    
    // Injection Essence
    "CONTRÔLE INJECTION ESSENCE": process.env.DEST_EMAIL_ATELIER_ESSENCE,
    "CONTROLE INJECTION ESSENCE": process.env.DEST_EMAIL_ATELIER_ESSENCE,
    
    // Arbre de Transmission
    "ARBRE DE TRANSMISSION": process.env.DEST_EMAIL_ATELIER_ARBRE
  };
  
  return mapping[serviceKey] || process.env.DEST_EMAIL_ATELIER_CULASSE || "";
}

// Formater une date
function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("fr-FR", { 
    day: "2-digit", 
    month: "2-digit", 
    year: "numeric" 
  });
}

// Email lors de la création d'une demande
export async function sendNewRequestEmail(caseData) {
  if (!transporter) {
    console.warn("[ATELIER] SMTP non configuré, email non envoyé");
    return { sent: false, reason: "SMTP non configuré" };
  }
  
  const header = (caseData.snapshot && caseData.snapshot.header) || {};
  const service = caseData.service || header.service || "";
  const recipientEmail = getEmailForService(service);
  
  if (!recipientEmail) {
    console.warn(`[ATELIER] Aucun email configuré pour le service "${service}"`);
    return { sent: false, reason: "Email non configuré" };
  }
  
  const no = String(caseData.no || "").padStart(5, "0");
  const client = caseData.client || header.client || "";
  const magasin = caseData.magasin || header.magasin || "";
  const vehicule = header.vehicule || "";
  const immat = header.immat || "";
  const dateDemande = formatDate(caseData.demandeDate || header.dateDemande);
  
  try {
    await transporter.sendMail({
      from: `Atelier Durand Services <${fromEmail}>`,
      to: recipientEmail,
      subject: `Nouvelle demande atelier n°${no} - ${service}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #004080; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .header h1 { margin: 0; font-size: 1.3rem; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .field { margin: 10px 0; }
    .label { font-weight: bold; color: #004080; }
    .value { color: #0f172a; }
    .footer { margin-top: 20px; padding: 15px; background: #f1f5f9; border-radius: 0 0 5px 5px; font-size: 0.9rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Nouvelle demande atelier</h1>
    </div>
    <div class="content">
      <div class="field">
        <span class="label">Numéro de dossier :</span>
        <span class="value">${no}</span>
      </div>
      <div class="field">
        <span class="label">Service :</span>
        <span class="value">${service}</span>
      </div>
      <div class="field">
        <span class="label">Client :</span>
        <span class="value">${client}</span>
      </div>
      <div class="field">
        <span class="label">Magasin :</span>
        <span class="value">${magasin}</span>
      </div>
      <div class="field">
        <span class="label">Véhicule :</span>
        <span class="value">${vehicule}</span>
      </div>
      <div class="field">
        <span class="label">Immatriculation :</span>
        <span class="value">${immat}</span>
      </div>
      <div class="field">
        <span class="label">Date de la demande :</span>
        <span class="value">${dateDemande}</span>
      </div>
    </div>
    <div class="footer">
      Ce message a été généré automatiquement par le système de gestion atelier.
    </div>
  </div>
</body>
</html>
      `
    });
    
    console.log(`[ATELIER] Email envoyé pour le dossier ${no} à ${recipientEmail}`);
    return { sent: true, to: recipientEmail };
  } catch (error) {
    console.error(`[ATELIER] Erreur envoi email dossier ${no}:`, error);
    return { sent: false, reason: error.message };
  }
}

// Email lors du passage au statut "Pièce Renvoyé"
export async function sendPieceReturnedEmail(caseData) {
  if (!transporter) {
    console.warn("[ATELIER] SMTP non configuré, email non envoyé");
    return { sent: false, reason: "SMTP non configuré" };
  }
  
  const header = (caseData.snapshot && caseData.snapshot.header) || {};
  const clientEmail = header.email || "";
  
  if (!clientEmail) {
    console.warn(`[ATELIER] Aucun email client pour le dossier ${caseData.no}`);
    return { sent: false, reason: "Email client non renseigné" };
  }
  
  const no = String(caseData.no || "").padStart(5, "0");
  const client = caseData.client || header.client || "";
  const magasin = caseData.magasin || header.magasin || "";
  const service = caseData.service || header.service || "";
  const vehicule = header.vehicule || "";
  const immat = header.immat || "";
  
  try {
    await transporter.sendMail({
      from: `Atelier Durand Services <${fromEmail}>`,
      to: clientEmail,
      subject: `Pièce renvoyée - Dossier n°${no}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #16a34a; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .header h1 { margin: 0; font-size: 1.3rem; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .field { margin: 10px 0; }
    .label { font-weight: bold; color: #16a34a; }
    .value { color: #0f172a; }
    .notice { background: #d1fae5; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0; }
    .footer { margin-top: 20px; padding: 15px; background: #f1f5f9; border-radius: 0 0 5px 5px; font-size: 0.9rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Pièce renvoyée</h1>
    </div>
    <div class="content">
      <div class="notice">
        <strong>Bonjour ${client},</strong><br><br>
        Votre pièce a été renvoyée au magasin ${magasin}.
      </div>
      
      <div class="field">
        <span class="label">Numéro de dossier :</span>
        <span class="value">${no}</span>
      </div>
      <div class="field">
        <span class="label">Service :</span>
        <span class="value">${service}</span>
      </div>
      <div class="field">
        <span class="label">Véhicule :</span>
        <span class="value">${vehicule} (${immat})</span>
      </div>
      <div class="field">
        <span class="label">Magasin :</span>
        <span class="value">${magasin}</span>
      </div>
      
      <div class="notice" style="margin-top: 20px;">
        <strong>Prochaines étapes :</strong><br>
        Vous pouvez récupérer votre pièce au magasin ${magasin}.
      </div>
    </div>
    <div class="footer">
      Ce message a été généré automatiquement par le système de gestion atelier.<br>
      Pour toute question, contactez votre magasin.
    </div>
  </div>
</body>
</html>
      `
    });
    
    console.log(`[ATELIER] Email envoyé pour le dossier ${no} à ${clientEmail}`);
    return { sent: true, to: clientEmail };
  } catch (error) {
    console.error(`[ATELIER] Erreur envoi email dossier ${no}:`, error);
    return { sent: false, reason: error.message };
  }
}

export default {
  sendNewRequestEmail,
  sendPieceReturnedEmail,
  getEmailForService
};
