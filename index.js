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
const options = {
  host: process.env.MQTT_HOST,    // es: xxxxxxx.s1.eu.hivemq.cloud
  port: process.env.MQTT_PORT,    // es: 8883
  protocol: "mqtts",
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS
};

const client = mqtt.connect(options);

client.on("connect", () => {
  console.log("✅ Connesso a HiveMQ Cloud via MQTT");
});

client.on("error", (err) => {
  console.error("❌ Errore MQTT:", err);
});

// --- Archivio dei codici e del loro utilizzo ---
let codes = {}; // { "12345": { user: "Marco", expiry: 1699999999999 } }
let logs = []; // ogni voce sarà { user, code, timestamp, action }

// --- Endpoint admin: genera codice ---
app.post("/admin/generate-code", (req, res) => {
  const { user, duration } = req.body;

  if (!user || !duration) {
    return res.status(400).json({ success: false, error: "Parametri mancanti" });
  }

  // Codice numerico a 5 cifre
  const code = Math.floor(10000 + Math.random() * 90000).toString();

  // Calcolo scadenza (durata in minuti -> ms)
  const expiry = Date.now() + duration * 60 * 1000;

  codes[code] = { user, expiry };

  console.log(`✅ Codice ${code} generato per ${user}, valido ${duration} min`);

  res.json({
    success: true,
    code,
    user,
    expiry
  });
});

// --- Endpoint utente: verifica codice ---
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body;

  if (!userCode || !codes[userCode]) {
    return res.status(401).json({ success: false, error: "Codice non valido" });
  }

  const codeInfo = codes[userCode];
  const now = Date.now();

  if (codeInfo.expiry < now) {
    delete codes[userCode]; 
    return res.status(401).json({ success: false, error: "Codice scaduto" });
  }

  // 🔹 Aggiungi al log
  logs.push({
    user: codeInfo.user,
    code: userCode,
    timestamp: new Date().toISOString(),
    action: "verify"
  });

  console.log(`✅ Codice ${userCode} accettato per utente ${codeInfo.user}`);

  res.json({
    success: true,
    user: codeInfo.user,
    code: userCode,
    expiresInSeconds: Math.floor((codeInfo.expiry - now) / 1000)
  });
});

// --- E>ndpoint admin: Lista log ---
app.get("/admin/logs", (req, res) => {
  res.json({ success: true, logs });
});

// --- Endpoint utente: invio comando ---
app.post("/send-command", (req, res) => {
  const { userCode, command } = req.body;
  const entry = codes[userCode];
  if (entry && entry.expiry > Date.now()) {
    client.publish("relay_1", command, { qos: 1 }, (err) => {
      if (err) {
        console.error("Errore invio comando:", err);
        return res.status(500).json({ success: false });
      }
      console.log(`⚡ Comando ${command} inviato da ${entry.user}`);
      res.json({ success: true, command, user: entry.user });
    });
  } else {
    res.json({ success: false, error: "Codice non valido o scaduto" });
  }
});

// --- Endpoint admin: lista codici attivi ---
app.get("/admin/list-codes", (req, res) => {
  const now = Date.now();
  const activeCodes = Object.entries(codes)
    .filter(([code, info]) => info.expiry > now)
    .map(([code, info]) => ({
      code,
      user: info.user,
      expiry: info.expiry,
      expiresInSeconds: Math.floor((info.expiry - now) / 1000)
    }));

  res.json({ success: true, activeCodes });
});

// --- Endpoint admin: elimina un codice ---
app.delete("/admin/delete-code/:code", (req, res) => {
  const code = req.params.code;

  if (codes[code]) {
    delete codes[code];
    console.log(`❌ Codice ${code} annullato manualmente dall'admin`);
    res.json({ success: true, message: `Codice ${code} eliminato` });
  } else {
    res.status(404).json({ success: false, error: "Codice non trovato" });
  }
});



// --- Avvio server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
});
