// index.js
import express from "express";
import cors from "cors";
import mqtt from "mqtt";
//import dotenv from "dotenv"; //per uso locale utilizza il file .env
import bodyParser from "body-parser";
//dotenv.config();

// --- Configurazione Express ---
const app = express();
app.use(bodyParser.json());
app.use(cors());  //! Abilita CORS per tutte le origini, modifica per limitare al dominio del frontend
//app.use(cors({
//  origin: "https://tuo-frontend.netlify.app"
//}));

// --- Connessione MQTT ---
const client = mqtt.connect({
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT),
  protocol: "mqtts",
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false
});

client.on("connect", () => console.log("✅ Connesso a HiveMQ Cloud via MQTT"));

// --- Storage in memoria (puoi sostituire con DB PostgreSQL in futuro) ---
let codes = {}; // { userCode: { user, expiry, expiresInSeconds } }
let logs = [];  // array di { user, code, action, timestamp }

// --- Helper log ---
function logAction({ user, code, action }) {
  logs.push({
    user: user || "-",
    code: code || "-",
    action,
    timestamp: Date.now()
  });
}

// --- Endpoint utente: verifica codice ---
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body;
  const entry = codes[userCode];

  if (!entry) {
    logAction({ user: "-", code: userCode, action: "INVALID" });
    return res.json({ success: false, error: "Codice non valido" });
  }

  if (entry.expiry <= Date.now()) {
    logAction({ user: entry.user, code: userCode, action: "EXPIRED" });
    delete codes[userCode];
    return res.json({ success: false, error: "Codice scaduto" });
  }

  logAction({ user: entry.user, code: userCode, action: "VERIFIED" });
  res.json({ success: true, user: entry.user });
});

// --- Endpoint utente: invio comando al relè ---
app.post("/send-command", (req, res) => {
  const { userCode, command } = req.body;
  const entry = codes[userCode];

  if (!entry || entry.expiry <= Date.now()) {
    return res.status(400).json({ success: false, error: "Codice non valido o scaduto" });
  }

  client.publish("relay_1", command, { qos: 1 }, (err) => {
    if (err) {
      console.error("Errore invio comando:", err);
      return res.status(500).json({ success: false });
    }
    logAction({ user: entry.user, code: userCode, action: "ACTIVATED" });
    res.json({ success: true, command, user: entry.user });
  });
});

// --- Endpoint admin: crea codice ---
app.post("/admin/create-code", (req, res) => {
  const { user, expiryDate } = req.body;
  const expiry = new Date(expiryDate+ ":00Z").getTime();
  if (isNaN(expiry)) return res.status(400).json({ success: false, error: "Data non valida" });

  const code = Math.floor(10000 + Math.random() * 90000).toString(); // 5 cifre
  const secondsRemaining = Math.floor((expiry - Date.now()) / 1000);

  codes[code] = { user, expiry, expiresInSeconds: secondsRemaining };
  logAction({ user, code, action: "CREATED" });

  res.json({ success: true, code, user, expiry: new Date(expiry).toLocaleString() });
});

// --- Endpoint admin: lista codici ---
app.get("/admin/list-codes", (req, res) => {
  const activeCodes = Object.entries(codes).map(([code, entry]) => {
    const expiresInSeconds = Math.floor((entry.expiry - Date.now()) / 1000);
    return { code, user: entry.user, expiry: entry.expiry, expiresInSeconds };
  });
  res.json({ activeCodes });
});

// --- Endpoint admin: elimina codice ---
app.delete("/admin/delete-code/:code", (req, res) => {
  const code = req.params.code;
  if (codes[code]) {
    const user = codes[code].user;
    delete codes[code];
    logAction({ user, code, action: "DELETED" });
    return res.json({ success: true });
  }
  res.json({ success: false, error: "Codice non trovato" });
});

// --- Endpoint admin: log ---
app.get("/admin/logs", (req, res) => {
  res.json({ logs });
});

// --- Controllo automatico codici scaduti ogni minuto ---
setInterval(() => {
  const now = Date.now();
  Object.entries(codes).forEach(([code, entry]) => {
    if (entry.expiry <= now) {
      logAction({ user: entry.user, code, action: "EXPIRED" });
      delete codes[code];
      console.log(`Codice ${code} di ${entry.user} è scaduto e rimosso.`);
    } else {
      entry.expiresInSeconds = Math.floor((entry.expiry - now) / 1000);
    }
  });
}, 60 * 1000); // ogni 60 secondi

// --- Avvio server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));