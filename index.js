import express from "express";
import cors from "cors";
import mqtt from "mqtt";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = mqtt.connect(process.env.MQTT_HOST, {
  port: parseInt(process.env.MQTT_PORT),
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false
});

client.on("connect", () => console.log("✅ Connesso a HiveMQ Cloud via MQTT"));

const VALID_CODE = "12345"; // 🔹 per test, poi generabile dinamico

// verifica codice
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body;
  if (userCode === VALID_CODE) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// invio comando relè
app.post("/send-command", (req, res) => {
  const { command } = req.body;
  client.publish(process.env.MQTT_TOPIC, command, (err) => {
    if (err) return res.status(500).json({ error: "Errore MQTT" });
    res.json({ success: true, command });
  });
});

app.listen(process.env.PORT || 3000, () => console.log("Server avviato"));
