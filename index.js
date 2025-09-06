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

// --- Archivio codici in memoria ---
let codes = {}; // { "12345": { user: "Marco", expiry: 1699999999999 } }

// --- Endpoint admin: genera codice ---
app.post("/admin/generate-code", (req, res) => {
  const { user, code, duration } = req.body;
  if (!user || !code || !duration) {
    return res.status(400).json({ success: false, error: "Dati mancanti" });
  }
  const expiry = Date.now() + duration * 1000; // durata in secondi
  codes[code] = { user, expiry };
  console.log(`🔑 Codice ${code} generato per ${user}, valido fino a ${new Date(expiry)}`);
  res.json({ success: true, code, expiry });
});

// --- Endpoint utente: verifica codice ---
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body;
  const entry = codes[userCode];
  if (entry && entry.expiry > Date.now()) {
    res.json({ success: true, user: entry.user });
  } else {
    res.json({ success: false });
  }
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
  const active = Object.entries(codes).map(([code, data]) => ({
    code,
    user: data.user,
    expiry: data.expiry
  }));
  res.json({ success: true, active });
});


// --- Avvio server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
});
