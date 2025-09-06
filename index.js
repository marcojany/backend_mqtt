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

// Helper: valida codice
function isValidCode(code) {
  return code === "12345"; // TODO: sostituire con logica reale in futuro
}

// ✅ SOLO verifica: NON pubblica su MQTT
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body || {};
  if (!userCode) return res.status(400).json({ success: false, error: "Codice mancante" });
  return res.json({ success: isValidCode(userCode) });
});

// ✅ Invio comando: pubblica su MQTT SOLO se il codice è valido
app.post("/send-command", (req, res) => {
  const { userCode, command } = req.body || {};
  if (!userCode || !command) {
    return res.status(400).json({ success: false, error: "Parametri mancanti" });
  }
  if (!isValidCode(userCode)) {
    return res.status(401).json({ success: false, error: "Codice non valido" });
  }

  const topic = process.env.MQTT_TOPIC || "relay_1";
  client.publish(topic, command, {}, (err) => {
    if (err) {
      console.error("Errore pubblicazione MQTT:", err);
      return res.status(500).json({ success: false, error: "MQTT publish failed" });
    }
    console.log(`➡️  Comando '${command}' inviato al topic ${topic}`);
    return res.json({ success: true, command });
  });
});


// --- Avvio server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
});
