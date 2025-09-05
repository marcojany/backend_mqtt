import express from "express";
import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// --- Connessione MQTT ---
const options = {
  host: process.env.MQTT_HOST,
  port: process.env.MQTT_PORT,
  protocol: "mqtts",
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS
};

const client = mqtt.connect(options);

client.on("connect", () => {
  console.log("✅ Connesso a HiveMQ Cloud via MQTT");
});

// --- API per inviare comando ---
app.post("/send-command", (req, res) => {
  const { command } = req.body; // es. { "command": "ON" }

  if (!command) {
    return res.status(400).json({ error: "Manca il comando" });
  }

  client.publish(process.env.MQTT_TOPIC, command, (err) => {
    if (err) {
      console.error("Errore MQTT:", err);
      return res.status(500).json({ error: "Errore pubblicazione MQTT" });
    }
    console.log(`➡️ Inviato comando MQTT: ${command}`);
    res.json({ success: true, command });
  });
});

// --- Avvio server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend in ascolto su http://localhost:${PORT}`);
});
