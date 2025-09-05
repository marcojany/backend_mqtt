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

// --- Endpoint per verifica codice ---
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body;

  if (!userCode) {
    return res.status(400).json({ success: false, error: "Codice mancante" });
  }

  // Esempio semplice: accetta solo "12345"
  if (userCode === "12345") {
    client.publish("relay_1", "ON", {}, (err) => {
      if (err) {
        console.error("Errore pubblicazione MQTT:", err);
        return res.status(500).json({ success: false, error: "MQTT publish failed" });
      }
      console.log("➡️  Comando ON inviato al topic relay_1");
      return res.json({ success: true, command: "ON" });
    });
  } else {
    return res.status(401).json({ success: false, error: "Codice non valido" });
  }
});

// --- Avvio server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
});
